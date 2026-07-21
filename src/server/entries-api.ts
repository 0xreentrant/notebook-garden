import Database from 'better-sqlite3'
import { getDbPath } from '../db/paths'
import type { ListPage, ListPageQuery } from '../lib/list-page'
import {
  appendNotebookLink,
  parseNotebookLinks,
  serializeNotebookLinks,
  type NotebookLink,
} from '../lib/notebook-links'
import { parseTags, serializeTags } from '../lib/tags'
import {
  buildCommonFilters,
  buildOrderBy,
  collectTagsFromRows,
  decodeCursor,
  encodeCursor,
  whereSql,
} from './list-page'

export const NOTEBOOKLM_URL_PREFIX = 'https://notebooklm.google.com/notebook/'

export const ENTRY_COLUMNS = `
  id, video_id, title, url, status, skip_backfill,
  error_message, summary_text, transcript_text, transcript_error,
  notebooklm_url, notebooklm_links, last_viewed, pinned, tags, created_at, updated_at, deleted_at
`

export type RawEntryRow = {
  id: number
  video_id: string
  title: string
  url: string
  status: string
  skip_backfill: number
  error_message: string | null
  summary_text: string | null
  transcript_text: string | null
  transcript_error: string | null
  notebooklm_url: string | null
  notebooklm_links: string
  last_viewed: string | null
  pinned: number
  tags: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type EntryPatchPayload = {
  notebooklm_url?: unknown
  notebooklm_link?: unknown
  last_viewed?: unknown
  pinned?: unknown
  tags?: unknown
}

export { getDbPath } from '../db/paths'

function isNotebookLink(value: unknown): value is NotebookLink {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as NotebookLink).url === 'string' &&
    (value as NotebookLink).url.startsWith(NOTEBOOKLM_URL_PREFIX) &&
    typeof (value as NotebookLink).title === 'string' &&
    !!(value as NotebookLink).title.trim()
  )
}

export function formatEntryRow(raw: RawEntryRow) {
  const notebooklm_links = parseNotebookLinks(raw.notebooklm_links)
  return {
    ...raw,
    tags: parseTags(raw.tags),
    notebooklm_links,
    // ponytail: keep notebooklm_url as latest link for older readers; multi-link source of truth is notebooklm_links
    notebooklm_url: notebooklm_links.at(-1)?.url ?? raw.notebooklm_url,
  }
}

function openDb(readonly = false) {
  return new Database(getDbPath(), { readonly, fileMustExist: true })
}

export function listEntries() {
  const db = openDb(true)
  try {
    const rows = db.prepare(`
      SELECT ${ENTRY_COLUMNS}
      FROM summary_entries
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
    `).all() as RawEntryRow[]
    return rows.map(formatEntryRow)
  } finally {
    db.close()
  }
}

export function listEntriesPage(query: ListPageQuery): ListPage<ReturnType<typeof formatEntryRow>> {
  const db = openDb(true)
  try {
    const filters = buildCommonFilters(query, {
      deletedAt: true,
      notebookLinksColumn: 'notebooklm_links',
      searchColumns: { title: 'title', tags: 'tags' },
    })
    const where = whereSql(filters.clauses)
    const orderBy = buildOrderBy(query.sort, query.pinsAtTop)
    const offset = decodeCursor(query.cursor)?.offset ?? 0

    // ponytail: offset pages are fine for personal SQLite; upgrade to keyset if concurrent writes cause skips

    const total = (db.prepare(`
      SELECT COUNT(*) AS count FROM summary_entries ${where}
    `).get(...filters.values) as { count: number }).count

    const tags = collectTagsFromRows(
      db.prepare(`SELECT tags FROM summary_entries WHERE deleted_at IS NULL`).all() as { tags: string }[],
    )

    const rows = db.prepare(`
      SELECT ${ENTRY_COLUMNS}
      FROM summary_entries
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...filters.values, query.limit, offset) as RawEntryRow[]

    const nextOffset = offset + rows.length
    return {
      items: rows.map(formatEntryRow),
      nextCursor: nextOffset < total ? encodeCursor({ offset: nextOffset }) : null,
      tags,
      total,
    }
  } finally {
    db.close()
  }
}

export function patchEntry(id: number, payload: EntryPatchPayload) {
  const sets: string[] = []
  const values: unknown[] = []

  let linkToAppend: NotebookLink | null = null
  if (payload.notebooklm_link !== undefined) {
    if (!isNotebookLink(payload.notebooklm_link)) {
      return {
        ok: false as const,
        status: 400,
        error: 'notebooklm_link must be { url, title } with a NotebookLM url',
      }
    }
    linkToAppend = {
      url: payload.notebooklm_link.url.trim(),
      title: payload.notebooklm_link.title.trim(),
    }
  } else if (payload.notebooklm_url !== undefined) {
    if (
      typeof payload.notebooklm_url !== 'string' ||
      !payload.notebooklm_url.startsWith(NOTEBOOKLM_URL_PREFIX)
    ) {
      return {
        ok: false as const,
        status: 400,
        error: 'notebooklm_url must start with https://notebooklm.google.com/notebook/',
      }
    }
    linkToAppend = {
      url: payload.notebooklm_url.trim(),
      title: 'NotebookLM',
    }
  }

  if (payload.last_viewed === true) {
    sets.push('last_viewed = ?')
    values.push(new Date().toISOString())
  }

  if (payload.pinned !== undefined) {
    if (typeof payload.pinned !== 'boolean') {
      return { ok: false as const, status: 400, error: 'pinned must be a boolean' }
    }
    sets.push('pinned = ?', 'updated_at = ?')
    values.push(payload.pinned ? 1 : 0, new Date().toISOString())
  }

  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags)) {
      return { ok: false as const, status: 400, error: 'tags must be an array of strings' }
    }
    if (!payload.tags.every((tag) => typeof tag === 'string')) {
      return { ok: false as const, status: 400, error: 'tags must be an array of strings' }
    }
    sets.push('tags = ?', 'updated_at = ?')
    values.push(serializeTags(payload.tags), new Date().toISOString())
  }

  if (linkToAppend == null && sets.length === 0) {
    return { ok: false as const, status: 400, error: 'No valid fields to update' }
  }

  const db = openDb()
  try {
    if (linkToAppend) {
      const current = db.prepare(`
        SELECT notebooklm_links FROM summary_entries
        WHERE id = ? AND deleted_at IS NULL
      `).get(id) as { notebooklm_links: string } | undefined
      if (!current) {
        return { ok: false as const, status: 404, error: 'Entry not found' }
      }
      const nextLinks = appendNotebookLink(
        parseNotebookLinks(current.notebooklm_links),
        linkToAppend,
      )
      sets.push('notebooklm_links = ?', 'notebooklm_url = ?', 'updated_at = ?')
      values.push(
        serializeNotebookLinks(nextLinks),
        linkToAppend.url,
        new Date().toISOString(),
      )
    }

    const result = db.prepare(`
      UPDATE summary_entries
      SET ${sets.join(', ')}
      WHERE id = ? AND deleted_at IS NULL
    `).run(...values, id)

    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'Entry not found' }
    }

    const row = db.prepare(`
      SELECT ${ENTRY_COLUMNS}
      FROM summary_entries
      WHERE id = ?
    `).get(id) as RawEntryRow | undefined

    return { ok: true as const, row: row ? formatEntryRow(row) : null }
  } finally {
    db.close()
  }
}

export function softDeleteEntry(id: number) {
  const db = openDb()
  try {
    const now = new Date().toISOString()
    const result = db.prepare(`
      UPDATE summary_entries
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(now, now, id)

    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'Entry not found' }
    }

    return { ok: true as const }
  } finally {
    db.close()
  }
}
