import Database from 'better-sqlite3'
import path from 'node:path'

const source = process.argv[2]
  ?? path.resolve(process.cwd(), '../_db-backups')
const localDb = process.env.SOURCE_LOCAL_DB
  ?? path.join(source, 'local.db')
const targetDb = process.env.APP_DB
  ?? path.resolve(process.cwd(), 'summaries.db')

const sourceSqlite = new Database(localDb, { readonly: true })
const targetSqlite = new Database(targetDb)

const rows = sourceSqlite.prepare(`
  SELECT notebooklm_id, title, url, last_viewed, pinned, tags, source_count, created_at
  FROM notebooks
`).all() as Array<{
  notebooklm_id: string
  title: string
  url: string
  last_viewed: string | null
  pinned: number
  tags: string
  source_count: number
  created_at: string
}>

const insert = targetSqlite.prepare(`
  INSERT INTO notebooks (notebooklm_id, title, url, last_viewed, pinned, tags, source_count, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(notebooklm_id) DO UPDATE SET
    title = excluded.title,
    url = excluded.url,
    last_viewed = excluded.last_viewed,
    source_count = excluded.source_count
`)

let imported = 0
for (const row of rows) {
  insert.run(
    row.notebooklm_id,
    row.title,
    row.url,
    row.last_viewed,
    row.pinned,
    row.tags,
    row.source_count,
    row.created_at,
  )
  imported += 1
}

sourceSqlite.close()
targetSqlite.close()
console.log(`imported ${imported} notebooks from ${localDb} into ${targetDb}`)
