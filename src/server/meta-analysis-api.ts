import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getDbPath } from './notebook-db'

function scriptPath() {
  return (
    process.env.META_ANALYSIS_SCRIPT
    ?? path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../scripts/generate-meta-analysis.py',
    )
  )
}

export type MetaAnalysisRow = {
  id: number
  content: string
  sourceFingerprint: string
  createdAt: string
}

export type MetaAnalysisGetResult = {
  currentFingerprint: string
  cacheHit: boolean
  analysis: MetaAnalysisRow | null
  generating: boolean
  lastError: string | null
  liveDraft: string
  liveTools: string[]
}

// ponytail: in-memory job state, lost on dev-server restart (the python process
// keeps running but its result is dropped). Upgrade path: persist job rows in the DB.
let running: Promise<void> | null = null
let lastError: string | null = null
let liveDraft = ''
let liveTools: string[] = []

const LIVE_DRAFT_MAX = 50_000
const LIVE_TOOLS_MAX = 20

function clearLive() {
  liveDraft = ''
  liveTools = []
}

function applyLiveLine(line: string) {
  if (!line.startsWith('LIVE\t')) return false
  try {
    const payload = JSON.parse(line.slice(5)) as { kind?: string; text?: string; label?: string }
    if (payload.kind === 'delta' && typeof payload.text === 'string') {
      liveDraft += payload.text
      if (liveDraft.length > LIVE_DRAFT_MAX) {
        liveDraft = liveDraft.slice(-LIVE_DRAFT_MAX)
      }
    } else if (payload.kind === 'tool' && typeof payload.label === 'string' && payload.label) {
      liveTools = [...liveTools, payload.label].slice(-LIVE_TOOLS_MAX)
    }
  } catch {
    // ignore malformed LIVE lines
  }
  return true
}

function openDb() {
  return new Database(getDbPath())
}

function tableFingerprint(
  conn: InstanceType<typeof Database>,
  table: string,
  where: string,
  dateCol: string,
): string {
  try {
    const row = conn
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(MAX(${dateCol}), '') AS mx FROM ${table} ${where}`,
      )
      .get() as { n: number; mx: string }
    return `${row.n}:${row.mx}`
  } catch {
    return '0:'
  }
}

// Must stay byte-identical to source_fingerprint() in scripts/generate-meta-analysis.py
// or the DB cache never hits.
export function currentSourceFingerprint(db?: InstanceType<typeof Database>): string {
  const owned = !db
  const conn = db ?? openDb()
  try {
    const s = tableFingerprint(
      conn,
      'summary_entries',
      "WHERE status = 'complete' AND deleted_at IS NULL",
      'updated_at',
    )
    let b = '0::0'
    try {
      const brow = conn
        .prepare(
          `
          SELECT COUNT(*) AS n,
                 COALESCE(MAX(updated_at), '') AS mx,
                 SUM(CASE WHEN summary_status = 'complete' THEN 1 ELSE 0 END) AS sc
          FROM bookmarks
          WHERE deleted_at IS NULL
          `,
        )
        .get() as { n: number; mx: string; sc: number | null }
      b = `${brow.n}:${brow.mx}:${brow.sc ?? 0}`
    } catch {
      // missing bookmarks table (or pre-migration schema) in tests
    }
    const l = tableFingerprint(conn, 'linkedin_saved_items', 'WHERE deleted_at IS NULL', 'updated_at')
    const nb = tableFingerprint(conn, 'notebooks', '', 'created_at')
    return `s${s}|b${b}|l${l}|nb${nb}`
  } finally {
    if (owned) conn.close()
  }
}

function mapRow(raw: {
  id: number
  content: string
  source_fingerprint: string
  created_at: string
}): MetaAnalysisRow {
  return {
    id: raw.id,
    content: raw.content,
    sourceFingerprint: raw.source_fingerprint,
    createdAt: raw.created_at,
  }
}

export function getLatestMetaAnalysis(): MetaAnalysisGetResult {
  const db = openDb()
  try {
    const fingerprint = currentSourceFingerprint(db)
    const raw = db
      .prepare(
        `
        SELECT id, content, source_fingerprint, created_at
        FROM meta_analyses
        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get() as
      | {
          id: number
          content: string
          source_fingerprint: string
          created_at: string
        }
      | undefined

    if (!raw) {
      return {
        currentFingerprint: fingerprint,
        cacheHit: false,
        analysis: null,
        generating: running !== null,
        lastError,
        liveDraft,
        liveTools,
      }
    }
    const analysis = mapRow(raw)
    return {
      currentFingerprint: fingerprint,
      cacheHit: analysis.sourceFingerprint === fingerprint,
      analysis,
      generating: running !== null,
      lastError,
      liveDraft,
      liveTools,
    }
  } finally {
    db.close()
  }
}

export function insertMetaAnalysis(content: string, sourceFingerprint: string): MetaAnalysisRow {
  const db = openDb()
  try {
    const createdAt = new Date().toISOString()
    const result = db
      .prepare(
        `
        INSERT INTO meta_analyses (content, source_fingerprint, created_at)
        VALUES (?, ?, ?)
        `,
      )
      .run(content, sourceFingerprint, createdAt)
    return {
      id: Number(result.lastInsertRowid),
      content,
      sourceFingerprint,
      createdAt,
    }
  } finally {
    db.close()
  }
}

function runGenerator(): Promise<void> {
  return new Promise((resolve) => {
    // ponytail: no wall-clock timeout; a hung agent keeps `generating` true forever.
    // Real errors (nonzero exit, empty output) resolve as soon as the process exits.
    const child = spawn('python3', [scriptPath(), '--db', getDbPath()], { env: process.env })
    let stdout = ''
    const stderrLines: string[] = []
    let stderrCarry = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => {
      const combined = stderrCarry + chunk
      const parts = combined.split(/\r?\n/)
      stderrCarry = parts.pop() ?? ''
      for (const line of parts) {
        if (!line) continue
        if (applyLiveLine(line)) continue
        stderrLines.push(line)
      }
    })
    child.on('error', (error) => {
      lastError = error.message
      clearLive()
      resolve()
    })
    child.on('close', (code) => {
      if (stderrCarry) {
        if (!applyLiveLine(stderrCarry)) stderrLines.push(stderrCarry)
        stderrCarry = ''
      }
      const stderr = stderrLines.join('\n').trim()
      if (code !== 0) {
        lastError = (stderr || stdout || `exit ${code}`).trim().slice(0, 2000)
        clearLive()
        resolve()
        return
      }
      const content = stdout.trim()
      if (!content) {
        lastError = 'Generator returned empty analysis'
        clearLive()
        resolve()
        return
      }
      const fingerprintFromScript = stderrLines.filter(Boolean).at(-1)
      insertMetaAnalysis(content, fingerprintFromScript || currentSourceFingerprint())
      lastError = null
      clearLive()
      resolve()
    })
  })
}

export function generateMetaAnalysis(options?: {
  force?: boolean
}): MetaAnalysisGetResult & { started: boolean } {
  const existing = getLatestMetaAnalysis()
  if (existing.generating) {
    return { ...existing, started: false }
  }
  if (existing.cacheHit && existing.analysis && !options?.force) {
    return { ...existing, started: false }
  }

  lastError = null
  clearLive()
  running = runGenerator().finally(() => {
    running = null
  })
  return { ...getLatestMetaAnalysis(), started: true }
}
