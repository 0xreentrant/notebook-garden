import { parseSearchWords, type ListPageQuery, type SearchScope } from '../lib/list-page'
import { normalizeTag } from '../lib/tags'

export type OffsetCursor = {
  offset: number
}

export function encodeCursor(payload: OffsetCursor): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | null): OffsetCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as OffsetCursor
    if (typeof parsed?.offset !== 'number' || !Number.isFinite(parsed.offset) || parsed.offset < 0) {
      return null
    }
    return { offset: Math.trunc(parsed.offset) }
  } catch {
    return null
  }
}

export function collectTagsFromRows(rows: { tags: string }[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.tags) as unknown
      if (!Array.isArray(parsed)) continue
      for (const tag of parsed) {
        if (typeof tag === 'string') {
          const normalized = normalizeTag(tag)
          if (normalized) set.add(normalized)
        }
      }
    } catch {
      // ignore malformed tags
    }
  }
  return [...set].sort()
}

type WhereParts = {
  clauses: string[]
  values: unknown[]
}

export function buildCommonFilters(
  query: ListPageQuery,
  options: {
    deletedAt?: boolean
    notebookLinksColumn?: string
    searchColumns: {
      title: string
      tags: string
      extra?: string[]
    }
  },
): WhereParts {
  const clauses: string[] = []
  const values: unknown[] = []

  if (options.deletedAt) {
    clauses.push('deleted_at IS NULL')
  }

  if (query.view === 'never_viewed') {
    clauses.push('last_viewed IS NULL')
  } else if (query.view === 'viewed') {
    clauses.push('last_viewed IS NOT NULL')
  }

  if (options.notebookLinksColumn) {
    if (query.notebook === 'with_notebook') {
      clauses.push(`${options.notebookLinksColumn} != '[]'`)
    } else if (query.notebook === 'without_notebook') {
      clauses.push(`${options.notebookLinksColumn} = '[]'`)
    }
  }

  if (query.tag !== 'all') {
    const tag = normalizeTag(query.tag)
    if (tag) {
      clauses.push(`${options.searchColumns.tags} LIKE ?`)
      values.push(`%"${tag}"%`)
    }
  }

  const words = parseSearchWords(query.search)
  for (const word of words) {
    const like = `%${word}%`
    const scope: SearchScope = query.searchScope
    const parts: string[] = []
    if (scope === 'all' || scope === 'title') {
      parts.push(`lower(${options.searchColumns.title}) LIKE ?`)
      values.push(like)
    }
    if (scope === 'all' || scope === 'tags') {
      parts.push(`lower(${options.searchColumns.tags}) LIKE ?`)
      values.push(like)
    }
    if (scope !== 'tags' && options.searchColumns.extra) {
      for (const column of options.searchColumns.extra) {
        parts.push(`lower(${column}) LIKE ?`)
        values.push(like)
      }
    }
    if (parts.length > 0) {
      clauses.push(`(${parts.join(' OR ')})`)
    }
  }

  return { clauses, values }
}

export function buildOrderBy(sort: string, pinsAtTop: boolean): string {
  const pinPrefix = pinsAtTop ? 'pinned DESC, ' : ''

  switch (sort) {
    case 'created_asc':
      return `${pinPrefix}created_at ASC, id ASC`
    case 'viewed_desc':
      return `${pinPrefix}(last_viewed IS NULL) ASC, last_viewed DESC, id DESC`
    case 'viewed_asc':
      return `${pinPrefix}(last_viewed IS NULL) ASC, last_viewed ASC, id ASC`
    case 'sources_desc':
      return `${pinPrefix}source_count DESC, id DESC`
    case 'sources_asc':
      return `${pinPrefix}source_count ASC, id ASC`
    case 'created_desc':
    default:
      return `${pinPrefix}created_at DESC, id DESC`
  }
}

export function whereSql(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}
