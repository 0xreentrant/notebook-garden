import Database from 'better-sqlite3'
import { createApp } from '../../server/app'
import { createTestDb } from './test-db'

export function request(app: ReturnType<typeof createApp>, url: string, init?: RequestInit) {
  return app.request(url, init)
}

export function openDb(dbPath: string) {
  return new Database(dbPath)
}

export type Harness = {
  app: ReturnType<typeof createApp>
  dbPath: string
  cleanup: () => void
  db: () => Database.Database
}

export function createHarness(): Harness {
  const { dbPath, cleanup } = createTestDb()
  process.env.APP_DB = dbPath
  const app = createApp()
  return {
    app,
    dbPath,
    cleanup: () => {
      cleanup()
      if (process.env.APP_DB === dbPath) delete process.env.APP_DB
    },
    db: () => openDb(dbPath),
  }
}

export function insertEntry(
  dbPath: string,
  overrides: Partial<{
    video_id: string
    title: string
    url: string
    status: string
    summary_text: string | null
    notebooklm_links: string
    notebooklm_url: string | null
    last_viewed: string | null
    pinned: number
    tags: string
    created_at: string
    updated_at: string
  }> = {},
) {
  const sqlite = openDb(dbPath)
  const now = overrides.created_at ?? '2026-01-01T00:00:00.000Z'
  const result = sqlite
    .prepare(
      `
    INSERT INTO summary_entries (
      video_id, title, url, status, skip_backfill, summary_text,
      notebooklm_url, notebooklm_links, last_viewed, pinned, tags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      overrides.video_id ?? `vid-${Math.random().toString(36).slice(2, 8)}`,
      overrides.title ?? 'Test video',
      overrides.url ?? 'https://www.youtube.com/watch?v=abc123',
      overrides.status ?? 'complete',
      overrides.summary_text ?? 'Summary body',
      overrides.notebooklm_url ?? null,
      overrides.notebooklm_links ?? '[]',
      overrides.last_viewed ?? null,
      overrides.pinned ?? 0,
      overrides.tags ?? '[]',
      now,
      overrides.updated_at ?? now,
    )
  sqlite.close()
  return Number(result.lastInsertRowid)
}

export function insertBookmark(
  dbPath: string,
  overrides: Partial<{
    url: string
    title: string
    folder_path: string
    chrome_profile: string
    summary_text: string | null
    summary_status: string
    notebooklm_links: string
    notebooklm_url: string | null
    last_viewed: string | null
    pinned: number
    tags: string
    created_at: string
    updated_at: string
  }> = {},
) {
  const sqlite = openDb(dbPath)
  const now = overrides.created_at ?? '2026-01-01T00:00:00.000Z'
  const result = sqlite
    .prepare(
      `
    INSERT INTO bookmarks (
      url, title, folder_path, chrome_profile, summary_text, summary_status,
      notebooklm_url, notebooklm_links, last_viewed, pinned, tags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      overrides.url ?? `https://example.com/${Math.random().toString(36).slice(2, 8)}`,
      overrides.title ?? 'Example',
      overrides.folder_path ?? 'Bookmarks Bar',
      overrides.chrome_profile ?? 'Default',
      overrides.summary_text ?? null,
      overrides.summary_status ?? 'pending',
      overrides.notebooklm_url ?? null,
      overrides.notebooklm_links ?? '[]',
      overrides.last_viewed ?? null,
      overrides.pinned ?? 0,
      overrides.tags ?? '[]',
      now,
      overrides.updated_at ?? now,
    )
  sqlite.close()
  return Number(result.lastInsertRowid)
}

export function insertNotebook(
  dbPath: string,
  overrides: Partial<{
    notebooklm_id: string
    title: string
    url: string
    last_viewed: string | null
    pinned: number
    tags: string
    source_count: number
    created_at: string
  }> = {},
) {
  const sqlite = openDb(dbPath)
  const id = overrides.notebooklm_id ?? crypto.randomUUID()
  const result = sqlite
    .prepare(
      `
    INSERT INTO notebooks (
      notebooklm_id, title, url, last_viewed, pinned, tags, source_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      id,
      overrides.title ?? 'Notebook',
      overrides.url ?? `https://notebooklm.google.com/notebook/${id}`,
      overrides.last_viewed ?? null,
      overrides.pinned ?? 0,
      overrides.tags ?? '[]',
      overrides.source_count ?? 0,
      overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    )
  sqlite.close()
  return Number(result.lastInsertRowid)
}

export function insertLinkedIn(
  dbPath: string,
  overrides: Partial<{
    linkedin_urn: string
    item_type: string
    linkedin_url: string
    source_url: string | null
    author_name: string | null
    title: string | null
    content_text: string | null
    capture_status: string
    notebooklm_links: string
    notebooklm_url: string | null
    last_viewed: string | null
    pinned: number
    tags: string
    created_at: string
    updated_at: string
  }> = {},
) {
  const sqlite = openDb(dbPath)
  const now = overrides.created_at ?? '2026-01-01T00:00:00.000Z'
  const urn = overrides.linkedin_urn ?? `urn:li:activity:${Math.floor(Math.random() * 1e9)}`
  const result = sqlite
    .prepare(
      `
    INSERT INTO linkedin_saved_items (
      linkedin_urn, item_type, linkedin_url, source_url, author_name, title, content_text,
      raw_metadata, capture_status, notebooklm_url, notebooklm_links, last_viewed, pinned, tags,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      urn,
      overrides.item_type ?? 'activity',
      overrides.linkedin_url ?? `https://www.linkedin.com/feed/update/${urn}`,
      overrides.source_url ?? null,
      overrides.author_name ?? 'Author',
      overrides.title ?? 'Saved post',
      overrides.content_text ?? 'Post body text',
      overrides.capture_status ?? 'complete',
      overrides.notebooklm_url ?? null,
      overrides.notebooklm_links ?? '[]',
      overrides.last_viewed ?? null,
      overrides.pinned ?? 0,
      overrides.tags ?? '[]',
      now,
      overrides.updated_at ?? now,
    )
  sqlite.close()
  return Number(result.lastInsertRowid)
}

export function notebookUrl(id: string) {
  return `https://notebooklm.google.com/notebook/${id}`
}
