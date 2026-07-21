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
}

// ponytail: in-memory job state, lost on dev-server restart (the python process
// keeps running but its result is dropped). Upgrade path: persist job rows in the DB.
let running: Promise<void> | null = null
let lastError: string | null = null

function openDb() {
  return new Database(getDbPath())
}

export function currentSourceFingerprint(db?: InstanceType<typeof Database>): string {
  const owned = !db
  const conn = db ?? openDb()
  try {
    const row = conn
      .prepare(
        `
        SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS mx
        FROM summary_entries
        WHERE status = 'complete' AND deleted_at IS NULL
        `,
      )
      .get() as { n: number; mx: string }
    return `${row.n}:${row.mx}`
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
      }
    }
    const analysis = mapRow(raw)
    return {
      currentFingerprint: fingerprint,
      cacheHit: analysis.sourceFingerprint === fingerprint,
      analysis,
      generating: running !== null,
      lastError,
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
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      lastError = error.message
      resolve()
    })
    child.on('close', (code) => {
      if (code !== 0) {
        lastError = (stderr || stdout || `exit ${code}`).trim().slice(0, 2000)
        resolve()
        return
      }
      const content = stdout.trim()
      if (!content) {
        lastError = 'Generator returned empty analysis'
        resolve()
        return
      }
      const fingerprintFromScript = stderr.trim().split('\n').filter(Boolean).at(-1)
      insertMetaAnalysis(content, fingerprintFromScript || currentSourceFingerprint())
      lastError = null
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
  running = runGenerator().finally(() => {
    running = null
  })
  return { ...getLatestMetaAnalysis(), started: true }
}
