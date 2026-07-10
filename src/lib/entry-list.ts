import type { SummaryEntryRow } from '@/types'

export type SortKey = 'created_desc' | 'created_asc' | 'viewed_desc' | 'viewed_asc'
export type ViewFilter = 'all' | 'never_viewed' | 'viewed'
export type NotebookFilter = 'all' | 'with_notebook' | 'without_notebook'
export type SearchScope = 'all' | 'title' | 'tags'

function compareIds(a: SummaryEntryRow, b: SummaryEntryRow, ascending: boolean) {
  return ascending ? a.id - b.id : b.id - a.id
}

export function sortEntries(entries: SummaryEntryRow[], sort: SortKey) {
  return [...entries].sort((a, b) => {
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

export function filterEntries(
  entries: SummaryEntryRow[],
  viewFilter: ViewFilter,
  notebookFilter: NotebookFilter,
  tagFilter = 'all',
) {
  return entries.filter((entry) => {
    if (viewFilter === 'never_viewed' && entry.last_viewed != null) return false
    if (viewFilter === 'viewed' && entry.last_viewed == null) return false
    if (notebookFilter === 'with_notebook' && entry.notebooklm_links.length === 0) return false
    if (notebookFilter === 'without_notebook' && entry.notebooklm_links.length > 0) return false
    if (tagFilter !== 'all' && !entry.tags.includes(tagFilter)) return false
    return true
  })
}

function tokenize(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
}

function wordMatches(token: string, queryWord: string) {
  return token.startsWith(queryWord) || queryWord.startsWith(token)
}

export function parseSearchWords(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function matchesWordSearch(
  title: string,
  tags: string[],
  queryWords: string[],
  scope: SearchScope = 'all',
) {
  if (queryWords.length === 0) return true

  const words: string[] = []
  if (scope === 'all' || scope === 'title') {
    for (const token of tokenize(title)) words.push(token)
  }
  if (scope === 'all' || scope === 'tags') {
    for (const tag of tags) {
      for (const token of tokenize(tag)) words.push(token)
    }
  }

  return queryWords.every((queryWord) =>
    words.some((token) => wordMatches(token, queryWord)),
  )
}

export function searchEntries(
  entries: SummaryEntryRow[],
  query: string,
  scope: SearchScope = 'all',
) {
  const queryWords = parseSearchWords(query)
  if (queryWords.length === 0) return entries

  return entries.filter((entry) =>
    matchesWordSearch(entry.title, entry.tags, queryWords, scope),
  )
}

export const selectClassName =
  'h-7 rounded-[min(var(--radius-md),12px)] border border-border bg-card px-2 text-sm text-card-foreground scheme-dark outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

export const PINS_AT_TOP_KEY = 'notebook-garden:summaries-pins-at-top'

export function readPinsAtTop() {
  const stored = localStorage.getItem(PINS_AT_TOP_KEY)
  if (stored === null) return true
  return stored === 'true'
}

export function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
