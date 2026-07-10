import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { createApp } from '../server/app'
import { getDbPath } from '../src/db/paths'

const TEST_DB = path.join(process.cwd(), 'test-app-e2e.db')

function request(app: ReturnType<typeof createApp>, url: string, init?: RequestInit) {
  return app.request(url, init)
}

function seedDb() {
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
      last_viewed TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebooklm_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      last_viewed TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      source_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (current_timestamp)
    );
    INSERT INTO summary_entries (
      video_id, title, url, status, skip_backfill, summary_text, tags, created_at, updated_at
    ) VALUES (
      'abc123', 'Test video', 'https://youtube.com/watch?v=abc123', 'complete', 0, 'Summary body', '[]',
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    );
    INSERT INTO notebooks (notebooklm_id, title, url, source_count, created_at)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'Garden notebook',
      'https://notebooklm.google.com/notebook/00000000-0000-4000-8000-000000000001',
      2,
      '2026-01-02T00:00:00Z'
    );
  `)
  db.close()
}

describe('notebook-garden API e2e', () => {
  beforeAll(() => {
    process.env.APP_DB = TEST_DB
    seedDb()
  })

  afterAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
    delete process.env.APP_DB
  })

  it('health check', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('lists summary entries', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/entries')
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].video_id).toBe('abc123')
  })

  it('lists cached notebooks', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/notebooks')
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Garden notebook')
  })

  it('patches entry tags', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/entries/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['plant'] }),
    })
    expect(res.status).toBe(200)
    const row = await res.json()
    expect(row.tags).toEqual(['plant'])
  })

  it('patches notebook pins', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/notebooks/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    expect(res.status).toBe(200)
    const row = await res.json()
    expect(row.pinned).toBe(1)
  })

  it('soft deletes entry', async () => {
    const app = createApp()
    const del = await request(app, 'http://localhost/api/entries/1', { method: 'DELETE' })
    expect(del.status).toBe(204)

    const list = await request(app, 'http://localhost/api/entries')
    expect(await list.json()).toHaveLength(0)

    const db = new Database(getDbPath(), { readonly: true })
    const row = db.prepare('SELECT deleted_at FROM summary_entries WHERE id = 1').get() as
      | { deleted_at: string | null }
      | undefined
    db.close()
    expect(row?.deleted_at).toBeTruthy()
  })
})
