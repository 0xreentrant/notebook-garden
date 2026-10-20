import { existsSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDbPath } from './paths'

const migrationsFolder = './drizzle'

export function applyMigrations(dbFile = getDbPath()) {
  const sqlite = new Database(dbFile)
  sqlite.pragma('journal_mode = WAL')
  migrate(drizzle(sqlite), { migrationsFolder })
  sqlite.close()
  return dbFile
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const hasMigrations = existsSync(migrationsFolder)
    && readdirSync(migrationsFolder).some((file) => file.endsWith('.sql'))
  if (hasMigrations) {
    const dbFile = applyMigrations()
    console.log(`migrations applied to ${dbFile}`)
  } else {
    console.log(`no migrations in ${migrationsFolder}; using existing schema in ${getDbPath()}`)
  }
}
