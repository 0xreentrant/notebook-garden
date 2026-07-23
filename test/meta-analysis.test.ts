import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const TEST_DB = path.join(process.cwd(), 'test-meta-analysis.db')
const OK_SCRIPT = path.join(process.cwd(), 'test-meta-ok.py')
const FAIL_SCRIPT = path.join(process.cwd(), 'test-meta-fail.py')
const LIVE_SCRIPT = path.join(process.cwd(), 'test-meta-live.py')

process.env.APP_DB = TEST_DB

const { generateMetaAnalysis, getLatestMetaAnalysis } = await import(
  '../src/server/meta-analysis-api'
)

async function waitForIdle() {
  for (let i = 0; i < 100; i++) {
    if (!getLatestMetaAnalysis().generating) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('generator never finished')
}

async function waitForLive() {
  for (let i = 0; i < 100; i++) {
    const state = getLatestMetaAnalysis()
    if (state.liveDraft.includes('Hello') && state.liveTools.includes('read README.md')) {
      return state
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('live stream never appeared')
}

beforeAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
  const db = new Database(TEST_DB)
  db.exec(`
    CREATE TABLE summary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      skip_backfill INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      summary_text TEXT,
      notebooklm_url TEXT,
      notebooklm_links TEXT NOT NULL DEFAULT '[]',
      last_viewed TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE meta_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  db.prepare(`
    INSERT INTO summary_entries (video_id, title, url, status, summary_text, created_at, updated_at)
    VALUES ('v1', 'T', 'u', 'complete', 'S', '2026-01-01', '2026-01-01')
  `).run()
  db.close()

  // Fingerprint matches the seeded row: 1 complete entry, max(updated_at) = 2026-01-01.
  // Other source tables are absent; bookmarks use the missing-table sentinel "0::0".
  fs.writeFileSync(OK_SCRIPT, [
    'import sys, time',
    'time.sleep(0.3)',
    'sys.stderr.write("s1:2026-01-01|b0::0|l0:|nb0:\\n")',
    'print("# analysis body")',
  ].join('\n'))
  fs.writeFileSync(FAIL_SCRIPT, [
    'import sys',
    'sys.stderr.write("boom\\n")',
    'sys.exit(1)',
  ].join('\n'))
  fs.writeFileSync(LIVE_SCRIPT, [
    'import sys, time, json',
    'def live(payload):',
    '  sys.stderr.write("LIVE\\t" + json.dumps(payload) + "\\n")',
    '  sys.stderr.flush()',
    'live({"kind":"tool","label":"read README.md"})',
    'time.sleep(0.15)',
    'live({"kind":"delta","text":"Hello"})',
    'time.sleep(0.15)',
    'live({"kind":"delta","text":" world"})',
    'time.sleep(0.4)',
    'sys.stderr.write("s1:2026-01-01|b0::0|l0:|nb0:\\n")',
    'print("# live analysis")',
  ].join('\n'))
})

afterAll(() => {
  for (const file of [TEST_DB, OK_SCRIPT, FAIL_SCRIPT, LIVE_SCRIPT]) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
})

describe('meta-analysis background generation', () => {
  it('reports generating while running, then caches the result', async () => {
    process.env.META_ANALYSIS_SCRIPT = OK_SCRIPT

    const kicked = generateMetaAnalysis()
    expect(kicked.started).toBe(true)
    expect(kicked.generating).toBe(true)
    expect(getLatestMetaAnalysis().generating).toBe(true)

    const dupe = generateMetaAnalysis({ force: true })
    expect(dupe.started).toBe(false)

    await waitForIdle()
    const done = getLatestMetaAnalysis()
    expect(done.generating).toBe(false)
    expect(done.lastError).toBeNull()
    expect(done.analysis?.content).toBe('# analysis body')
    expect(done.cacheHit).toBe(true)
    expect(done.liveDraft).toBe('')
    expect(done.liveTools).toEqual([])

    expect(generateMetaAnalysis().started).toBe(false)
  })

  it('surfaces failures via lastError and keeps the cached analysis', async () => {
    process.env.META_ANALYSIS_SCRIPT = FAIL_SCRIPT

    expect(generateMetaAnalysis({ force: true }).started).toBe(true)
    await waitForIdle()

    const after = getLatestMetaAnalysis()
    expect(after.lastError).toContain('boom')
    expect(after.analysis?.content).toBe('# analysis body')
  })

  it('exposes LIVE tool and delta events while generating, then clears them', async () => {
    process.env.META_ANALYSIS_SCRIPT = LIVE_SCRIPT

    expect(generateMetaAnalysis({ force: true }).started).toBe(true)
    const mid = await waitForLive()
    expect(mid.generating).toBe(true)
    expect(mid.liveDraft).toContain('Hello')
    expect(mid.liveTools).toContain('read README.md')

    await waitForIdle()
    const done = getLatestMetaAnalysis()
    expect(done.analysis?.content).toBe('# live analysis')
    expect(done.liveDraft).toBe('')
    expect(done.liveTools).toEqual([])
    expect(done.lastError).toBeNull()
  })
})
