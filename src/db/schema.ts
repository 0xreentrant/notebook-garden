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

export const linkedinSavedItems = sqliteTable('linkedin_saved_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  linkedinUrn: text('linkedin_urn').notNull().unique(),
  itemType: text('item_type', { enum: ['activity', 'article'] }).notNull(),
  linkedinUrl: text('linkedin_url').notNull(),
  sourceUrl: text('source_url'),
  authorName: text('author_name'),
  authorUrl: text('author_url'),
  authorHeadline: text('author_headline'),
  title: text('title'),
  contentText: text('content_text'),
  rawMetadata: text('raw_metadata').notNull().default('{}'),
  contentHash: text('content_hash'),
  extractedAt: text('extracted_at'),
  captureStatus: text('capture_status', {
    enum: ['pending', 'complete', 'metadata_only', 'error'],
  }).notNull(),
  captureError: text('capture_error'),
  enrichmentStatus: text('enrichment_status', {
    enum: ['pending', 'complete', 'error'],
  }).notNull().default('pending'),
  enrichmentError: text('enrichment_error'),
  summaryText: text('summary_text'),
  enrichmentModel: text('enrichment_model'),
  enrichmentPromptVersion: text('enrichment_prompt_version'),
  enrichedAt: text('enriched_at'),
  notebooklmUrl: text('notebooklm_url'),
  notebooklmLinks: text('notebooklm_links').notNull().default('[]'),
  lastViewed: text('last_viewed'),
  pinned: integer('pinned').notNull().default(0),
  tags: text('tags').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export type SummaryEntry = typeof summaryEntries.$inferSelect
export type Notebook = typeof notebooks.$inferSelect
export type Bookmark = typeof bookmarks.$inferSelect
export type MetaAnalysis = typeof metaAnalyses.$inferSelect
export type LinkedInSavedItem = typeof linkedinSavedItems.$inferSelect
