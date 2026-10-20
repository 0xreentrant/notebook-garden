import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { applyMigrations } from '../src/db/migrate'

describe('applyMigrations', () => {
  it('builds the schema in a new file and leaves rows in place on a second run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ng-migrate-'))
    const dbPath = path.join(dir, 'empty.db')
    try {
      applyMigrations(dbPath)
      const sqlite = new Database(dbPath)
      sqlite.prepare(
        `INSERT INTO summary_entries (
          video_id, title, url, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('abc', 'Title', 'https://example.test', 'complete', 't', 't')
      sqlite.close()

      applyMigrations(dbPath)

      const check = new Database(dbPath, { readonly: true, fileMustExist: true })
      const tables = check.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).all() as { name: string }[]
      const count = check.prepare('SELECT COUNT(*) AS n FROM summary_entries').get() as { n: number }
      check.close()

      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        'summary_entries',
        'notebooks',
        'bookmarks',
        'meta_analyses',
        'linkedin_saved_items',
      ]))
      expect(count.n).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
