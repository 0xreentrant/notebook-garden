import type { BookmarkRow } from '@/types'
import {
  formatTimestamp,
  matchesWordSearch,
  parseSearchWords,
  type NotebookFilter,
  type SearchScope,
  type SortKey,
  type ViewFilter,
} from '@/lib/entry-list'

export type { NotebookFilter, SearchScope, SortKey, ViewFilter }
export { formatTimestamp }

export const BOOKMARK_PINS_AT_TOP_KEY = 'notebook-garden:bookmarks-pins-at-top'

export function readBookmarkPinsAtTop() {
  const stored = localStorage.getItem(BOOKMARK_PINS_AT_TOP_KEY)
  if (stored === null) return true
  return stored === 'true'
}

function compareIds(a: BookmarkRow, b: BookmarkRow, ascending: boolean) {
  return ascending ? a.id - b.id : b.id - a.id
}

export function sortBookmarks(bookmarks: BookmarkRow[], sort: SortKey) {
  return [...bookmarks].sort((a, b) => {
    if (sort === 'created_desc' || sort === 'created_asc') {
      const ascending = sort === 'created_asc'
      const aTime = new Date(a.created_at).getTime()
      const bTime = new Date(b.created_at).getTime()
      const diff = aTime - bTime
      if (diff !== 0) return ascending ? diff : -diff
      return compareIds(a, b, ascending)
    }

    const ascending = sort === 'viewed_asc'
    const aViewed = a.last_viewed ? new Date(a.last_viewed).getTime() : null
    const bViewed = b.last_viewed ? new Date(b.last_viewed).getTime() : null

    if (aViewed === null && bViewed === null) return compareIds(a, b, ascending)
    if (aViewed === null) return 1
    if (bViewed === null) return -1

    const diff = aViewed - bViewed
    if (diff !== 0) return ascending ? diff : -diff
    return compareIds(a, b, ascending)
  })
}

export function filterBookmarks(
  bookmarks: BookmarkRow[],
  viewFilter: ViewFilter,
  notebookFilter: NotebookFilter,
  tagFilter = 'all',
) {
  return bookmarks.filter((bookmark) => {
    if (viewFilter === 'never_viewed' && bookmark.last_viewed != null) return false
    if (viewFilter === 'viewed' && bookmark.last_viewed == null) return false
    if (notebookFilter === 'with_notebook' && bookmark.notebooklm_links.length === 0) return false
    if (notebookFilter === 'without_notebook' && bookmark.notebooklm_links.length > 0) return false
    if (tagFilter !== 'all' && !bookmark.tags.includes(tagFilter)) return false
    return true
  })
}

export function searchBookmarks(
  bookmarks: BookmarkRow[],
  query: string,
  scope: SearchScope = 'all',
) {
  const queryWords = parseSearchWords(query)
  if (queryWords.length === 0) return bookmarks

  return bookmarks.filter((bookmark) => {
    if (matchesWordSearch(bookmark.title, bookmark.tags, queryWords, scope)) return true
    if (scope === 'tags') return false
    const haystack = `${bookmark.folder_path} ${bookmark.chrome_profile} ${bookmark.url}`.toLowerCase()
    return queryWords.every((word) => haystack.includes(word))
  })
}

export const selectClassName =
  'h-7 rounded-[min(var(--radius-md),12px)] border border-border bg-card px-2 text-sm text-card-foreground scheme-dark outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
