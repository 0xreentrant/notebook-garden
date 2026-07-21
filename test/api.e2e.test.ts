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
      transcript_text TEXT,
      transcript_error TEXT,
      notebooklm_url TEXT,
      notebooklm_links TEXT NOT NULL DEFAULT '[]',
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
    CREATE TABLE bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      folder_path TEXT NOT NULL DEFAULT '',
      chrome_profile TEXT NOT NULL,
      notebooklm_url TEXT,
      notebooklm_links TEXT NOT NULL DEFAULT '[]',
      last_viewed TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    INSERT INTO summary_entries (
      video_id, title, url, status, skip_backfill, summary_text, transcript_text, tags, created_at, updated_at
    ) VALUES
      ('abc123', 'Test video', 'https://youtube.com/watch?v=abc123', 'complete', 0, 'Summary body', 'Full transcript here', '["plant"]',
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('def456', 'Garden tips', 'https://youtube.com/watch?v=def456', 'complete', 0, 'More', NULL, '[]',
       '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
      ('ghi789', 'Soil science', 'https://youtube.com/watch?v=ghi789', 'complete', 0, 'Dirt', NULL, '["plant"]',
       '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');
    INSERT INTO notebooks (notebooklm_id, title, url, source_count, created_at)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'Garden notebook',
      'https://notebooklm.google.com/notebook/00000000-0000-4000-8000-000000000001',
      2,
      '2026-01-02T00:00:00Z'
    );
    INSERT INTO bookmarks (
      url, title, folder_path, chrome_profile, tags, created_at, updated_at
    ) VALUES (
      'https://example.com', 'Example', 'Bookmarks Bar', 'Default', '[]',
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
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

  it('lists summary entries as a page', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/entries?limit=2')
    expect(res.status).toBe(200)
    const page = await res.json()
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(3)
    expect(page.nextCursor).toBeTruthy()
    expect(page.items[0].video_id).toBe('ghi789')
  })

  it('loads the next entries page', async () => {
    const app = createApp()
    const first = await (await request(app, 'http://localhost/api/entries?limit=2')).json()
    const second = await (
      await request(app, `http://localhost/api/entries?limit=2&cursor=${first.nextCursor}`)
    ).json()
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(second.items[0].video_id).toBe('abc123')
    expect(second.items[0].transcript_text).toBe('Full transcript here')
    expect(second.items[0].transcript_error).toBeNull()
  })

  it('filters entries by search and tag', async () => {
    const app = createApp()
    const res = await request(
      app,
      'http://localhost/api/entries?search=soil&tag=plant&limit=50',
    )
    const page = await res.json()
    expect(page.total).toBe(1)
    expect(page.items[0].title).toBe('Soil science')
  })

  it('lists cached notebooks as a page', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/notebooks')
    expect(res.status).toBe(200)
    const page = await res.json()
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Garden notebook')
  })

  it('lists bookmarks as a page', async () => {
    const app = createApp()
    const res = await request(app, 'http://localhost/api/bookmarks')
    expect(res.status).toBe(200)
    const page = await res.json()
    expect(page.items).toHaveLength(1)
    expect(page.items[0].title).toBe('Example')
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
    const page = await list.json()
    expect(page.total).toBe(2)

    const db = new Database(getDbPath(), { readonly: true })
    const row = db.prepare('SELECT deleted_at FROM summary_entries WHERE id = 1').get() as
      | { deleted_at: string | null }
      | undefined
    db.close()
    expect(row?.deleted_at).toBeTruthy()
  })
})
