export type SummaryEntryRow = {
  id: number
  video_id: string
  title: string
  url: string
  status: 'pending' | 'complete' | 'error'
  skip_backfill: number
  error_message: string | null
  summary_text: string | null
  notebooklm_url: string | null
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

export type AppView = 'summaries' | 'library'
