import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

/** Full current schema - drizzle migrations are alter-only against existing DBs. */
export function applySchema(dbPath: string) {
  const sqlite = new Database(dbPath)
  sqlite.exec(`
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
      summary_text TEXT,
      summary_status TEXT NOT NULL DEFAULT 'pending',
      summary_error TEXT,
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
    CREATE TABLE linkedin_saved_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      linkedin_urn TEXT NOT NULL UNIQUE,
      item_type TEXT NOT NULL,
      linkedin_url TEXT NOT NULL,
      source_url TEXT,
      author_name TEXT,
      author_url TEXT,
      author_headline TEXT,
      title TEXT,
      content_text TEXT,
      raw_metadata TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT,
      extracted_at TEXT,
      capture_status TEXT NOT NULL,
      capture_error TEXT,
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      enrichment_error TEXT,
      summary_text TEXT,
      enrichment_model TEXT,
      enrichment_prompt_version TEXT,
      enriched_at TEXT,
      notebooklm_url TEXT,
      notebooklm_links TEXT NOT NULL DEFAULT '[]',
      last_viewed TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `)
  sqlite.close()
}

export function createTestDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'notebook-garden-test-'))
  const dbPath = path.join(dir, 'test.db')
  applySchema(dbPath)

  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function seedSummaryEntry(
  dbPath: string,
  overrides: Partial<{
    video_id: string
    title: string
    url: string
    status: string
  }> = {},
) {
  const sqlite = new Database(dbPath)
  const now = new Date().toISOString()
  sqlite
    .prepare(
      `
    INSERT INTO summary_entries (
      video_id, title, url, status, skip_backfill, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?)
  `,
    )
    .run(
      overrides.video_id ?? 'abc123',
      overrides.title ?? 'Test video',
      overrides.url ?? 'https://www.youtube.com/watch?v=abc123',
      overrides.status ?? 'complete',
      now,
      now,
    )
  sqlite.close()
}
