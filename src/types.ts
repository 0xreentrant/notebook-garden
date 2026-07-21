import type { NotebookLink } from './lib/notebook-links'

export type { NotebookLink }

export type SummaryEntryRow = {
  id: number
  video_id: string
  title: string
  url: string
  status: 'pending' | 'complete' | 'error'
  skip_backfill: number
  error_message: string | null
  summary_text: string | null
  transcript_text: string | null
  transcript_error: string | null
  notebooklm_url: string | null
  notebooklm_links: NotebookLink[]
  last_viewed: string | null
  pinned: number
  tags: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type NotebookRow = {
  id: number
  notebooklm_id: string
  title: string
  url: string
  last_viewed: string | null
  pinned: number
  tags: string[]
  source_count: number
  created_at: string
}

export type NotebookSyncPayload = {
  notebooklmId: string
  title: string
  url: string
  created_at?: string | null
  last_viewed?: string | null
  source_count?: number
}

export type BookmarkRow = {
  id: number
  url: string
  title: string
  folder_path: string
  chrome_profile: string
  notebooklm_url: string | null
  notebooklm_links: NotebookLink[]
  last_viewed: string | null
  pinned: number
  tags: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type LinkedInSavedItemRow = {
  id: number
  linkedin_urn: string
  item_type: 'activity' | 'article'
  linkedin_url: string
  source_url: string | null
  author_name: string | null
  author_url: string | null
  author_headline: string | null
  title: string | null
  content_text: string | null
  raw_metadata: Record<string, unknown>
  content_hash: string | null
  extracted_at: string | null
  capture_status: 'pending' | 'complete' | 'metadata_only' | 'error'
  capture_error: string | null
  enrichment_status: 'pending' | 'complete' | 'error'
  enrichment_error: string | null
  summary_text: string | null
  enrichment_model: string | null
  enrichment_prompt_version: string | null
  enriched_at: string | null
  notebooklm_url: string | null
  notebooklm_links: NotebookLink[]
  last_viewed: string | null
  pinned: number
  tags: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type AppView = 'summaries' | 'library' | 'bookmarks' | 'linkedin'
