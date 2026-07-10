import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getDbPath } from './paths'
import * as schema from './schema'

export const DB_FILE = getDbPath()

export const sqlite = new Database(DB_FILE, { fileMustExist: true })
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
