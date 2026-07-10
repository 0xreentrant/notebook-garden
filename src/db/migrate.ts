import { existsSync, readdirSync } from 'node:fs'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db, DB_FILE } from './client'

const migrationsFolder = './drizzle'
const hasMigrations =
  existsSync(migrationsFolder) &&
  readdirSync(migrationsFolder).some((file) => file.endsWith('.sql'))

if (hasMigrations) {
  migrate(db, { migrationsFolder })
  console.log(`migrations applied to ${DB_FILE}`)
} else {
  console.log(`no migrations in ${migrationsFolder}; using existing schema in ${DB_FILE}`)
}
