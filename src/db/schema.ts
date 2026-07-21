import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const summaryEntries = sqliteTable('summary_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull().unique(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  status: text('status', { enum: ['pending', 'complete', 'error'] }).notNull(),
  skipBackfill: integer('skip_backfill').notNull().default(0),
  errorMessage: text('error_message'),
  summaryText: text('summary_text'),
  transcriptText: text('transcript_text'),
  transcriptError: text('transcript_error'),
  notebooklmUrl: text('notebooklm_url'),
  notebooklmLinks: text('notebooklm_links').notNull().default('[]'),
  lastViewed: text('last_viewed'),
  pinned: integer('pinned').notNull().default(0),
  tags: text('tags').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const notebooks = sqliteTable('notebooks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  notebooklmId: text('notebooklm_id').notNull().unique(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  lastViewed: text('last_viewed'),
  pinned: integer('pinned').notNull().default(0),
  tags: text('tags').notNull().default('[]'),
  sourceCount: integer('source_count').notNull().default(0),
  createdAt: text('created_at').default(sql`(current_timestamp)`).notNull(),
})

export const bookmarks = sqliteTable('bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  folderPath: text('folder_path').notNull().default(''),
  chromeProfile: text('chrome_profile').notNull(),
  notebooklmUrl: text('notebooklm_url'),
  notebooklmLinks: text('notebooklm_links').notNull().default('[]'),
  lastViewed: text('last_viewed'),
  pinned: integer('pinned').notNull().default(0),
  tags: text('tags').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const metaAnalyses = sqliteTable('meta_analyses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  content: text('content').notNull(),
  sourceFingerprint: text('source_fingerprint').notNull(),
  createdAt: text('created_at').notNull(),
})

export type SummaryEntry = typeof summaryEntries.$inferSelect
export type Notebook = typeof notebooks.$inferSelect
export type Bookmark = typeof bookmarks.$inferSelect
export type MetaAnalysis = typeof metaAnalyses.$inferSelect
