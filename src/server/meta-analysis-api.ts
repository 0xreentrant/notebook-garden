import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getDbPath } from './notebook-db'

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/generate-meta-analysis.py',
)

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
}

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
      return { currentFingerprint: fingerprint, cacheHit: false, analysis: null }
    }
    const analysis = mapRow(raw)
    const cacheHit = analysis.sourceFingerprint === fingerprint
    return {
      currentFingerprint: fingerprint,
      cacheHit,
      analysis: cacheHit ? analysis : null,
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

export function generateMetaAnalysis(options?: {
  force?: boolean
}): MetaAnalysisGetResult & { generated: boolean; error?: string } {
  const existing = getLatestMetaAnalysis()
  if (existing.cacheHit && existing.analysis && !options?.force) {
    return { ...existing, generated: false }
  }

  const dbPath = getDbPath()
  const result = spawnSync(
    'python3',
    [SCRIPT, '--db', dbPath],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 650_000,
      env: process.env,
    },
  )

  if (result.error) {
    return {
      ...existing,
      generated: false,
      error: result.error.message,
    }
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim()
    return {
      ...existing,
      generated: false,
      error: detail.slice(0, 2000),
    }
  }

  const content = (result.stdout || '').trim()
  const fingerprintFromScript = (result.stderr || '').trim().split('\n').filter(Boolean).at(-1)
  const fingerprint = fingerprintFromScript || currentSourceFingerprint()
  if (!content) {
    return { ...existing, generated: false, error: 'Generator returned empty analysis' }
  }

  const analysis = insertMetaAnalysis(content, fingerprint)
  return {
    currentFingerprint: fingerprint,
    cacheHit: true,
    analysis,
    generated: true,
  }
}
