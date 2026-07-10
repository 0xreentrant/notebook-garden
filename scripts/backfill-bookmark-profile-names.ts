import Database from 'better-sqlite3'
import { getDbPath } from '../src/db/paths.ts'
import { readChromeProfileDisplayNames } from '../src/server/chrome-bookmarks.ts'

const dbPath = getDbPath()
const names = readChromeProfileDisplayNames()
if (names.size === 0) {
  console.error('No Chrome profile display names found in Local State')
  process.exit(1)
}

const db = new Database(dbPath)
try {
  const update = db.prepare(`
    UPDATE bookmarks
    SET chrome_profile = ?, updated_at = ?
    WHERE chrome_profile = ?
  `)
  const now = new Date().toISOString()
  let updated = 0
  const run = db.transaction(() => {
    for (const [dir, display] of names) {
      if (dir === display) continue
      const result = update.run(display, now, dir)
      updated += result.changes
    }
  })
  run()
  console.log(`backfilled ${updated} bookmark rows in ${dbPath}`)
  for (const [dir, display] of names) {
    console.log(`  ${dir} -> ${display}`)
  }
} finally {
  db.close()
}
