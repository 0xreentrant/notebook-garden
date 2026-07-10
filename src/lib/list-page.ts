export const DEFAULT_PAGE_SIZE = 50

export type SortKey = 'created_desc' | 'created_asc' | 'viewed_desc' | 'viewed_asc'
export type NotebookSortKey = SortKey | 'sources_desc' | 'sources_asc'
export type ViewFilter = 'all' | 'never_viewed' | 'viewed'
export type NotebookFilter = 'all' | 'with_notebook' | 'without_notebook'
export type SearchScope = 'all' | 'title' | 'tags'

export type ListPageQuery = {
  limit: number
  cursor: string | null
  sort: string
  view: ViewFilter
  notebook: NotebookFilter
  tag: string
  search: string
  searchScope: SearchScope
  pinsAtTop: boolean
}

export type ListPage<T> = {
  items: T[]
  nextCursor: string | null
  tags: string[]
  total: number
}

const VIEW_FILTERS = new Set<ViewFilter>(['all', 'never_viewed', 'viewed'])
const NOTEBOOK_FILTERS = new Set<NotebookFilter>(['all', 'with_notebook', 'without_notebook'])
const SEARCH_SCOPES = new Set<SearchScope>(['all', 'title', 'tags'])

function asEnum<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  if (value && allowed.has(value as T)) return value as T
  return fallback
}

export function parseListPageQuery(
  searchParams: URLSearchParams,
  options?: { defaultSort?: string; allowNotebookFilter?: boolean },
): ListPageQuery {
  const limitRaw = Number(searchParams.get('limit') ?? DEFAULT_PAGE_SIZE)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100)
    : DEFAULT_PAGE_SIZE

  return {
    limit,
    cursor: searchParams.get('cursor'),
    sort: searchParams.get('sort') ?? options?.defaultSort ?? 'created_desc',
    view: asEnum(searchParams.get('view'), VIEW_FILTERS, 'all'),
    notebook: options?.allowNotebookFilter === false
      ? 'all'
      : asEnum(searchParams.get('notebook'), NOTEBOOK_FILTERS, 'all'),
    tag: searchParams.get('tag') ?? 'all',
    search: searchParams.get('search') ?? '',
    searchScope: asEnum(searchParams.get('searchScope'), SEARCH_SCOPES, 'all'),
    pinsAtTop: searchParams.get('pinsAtTop') !== 'false',
  }
}

export function buildListQueryString(
  query: Omit<ListPageQuery, 'limit' | 'cursor'> & {
    limit?: number
    cursor?: string | null
  },
): string {
  const params = new URLSearchParams()
  params.set('limit', String(query.limit ?? DEFAULT_PAGE_SIZE))
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('sort', query.sort)
  params.set('view', query.view)
  if (query.notebook !== 'all') params.set('notebook', query.notebook)
  if (query.tag !== 'all') params.set('tag', query.tag)
  if (query.search.trim()) params.set('search', query.search.trim())
  if (query.searchScope !== 'all') params.set('searchScope', query.searchScope)
  params.set('pinsAtTop', String(query.pinsAtTop))
  return params.toString()
}

export function parseSearchWords(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}
