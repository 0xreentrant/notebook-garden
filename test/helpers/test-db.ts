import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function createTestDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'notebook-garden-test-'))
  const dbPath = path.join(dir, 'test.db')
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') })
  sqlite.close()

  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function seedSummaryEntry(dbPath: string, overrides: Partial<{
  video_id: string
  title: string
  url: string
  status: string
}> = {}) {
  const sqlite = new Database(dbPath)
  const now = new Date().toISOString()
  sqlite.prepare(`
    INSERT INTO summary_entries (
      video_id, title, url, status, skip_backfill, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(
    overrides.video_id ?? 'abc123',
    overrides.title ?? 'Test video',
    overrides.url ?? 'https://www.youtube.com/watch?v=abc123',
    overrides.status ?? 'complete',
    now,
    now,
  )
  sqlite.close()
}
