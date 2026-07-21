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
import { NOTEBOOKLM_URL_PREFIX } from './entries-api'
import {
  buildCommonFilters,
  buildOrderBy,
  collectTagsFromRows,
  decodeCursor,
  encodeCursor,
  whereSql,
} from './list-page'

export const LINKEDIN_COLUMNS = `
  id, linkedin_urn, item_type, linkedin_url, source_url,
  author_name, author_url, author_headline, title, content_text,
  raw_metadata, content_hash, extracted_at,
  capture_status, capture_error, enrichment_status, enrichment_error,
  summary_text, enrichment_model, enrichment_prompt_version, enriched_at,
  notebooklm_url, notebooklm_links, last_viewed, pinned, tags,
  created_at, updated_at, deleted_at
`

export type RawLinkedInSavedRow = {
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
  raw_metadata: string
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
  notebooklm_links: string
  last_viewed: string | null
  pinned: number
  tags: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type LinkedInSavedPatchPayload = {
  notebooklm_url?: unknown
  notebooklm_link?: unknown
  last_viewed?: unknown
  pinned?: unknown
  tags?: unknown
}

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

export function formatLinkedInSavedRow(raw: RawLinkedInSavedRow) {
  const notebooklm_links = parseNotebookLinks(raw.notebooklm_links)
  let raw_metadata: Record<string, unknown> = {}
  try {
    raw_metadata = JSON.parse(raw.raw_metadata || '{}') as Record<string, unknown>
  } catch {
    raw_metadata = {}
  }
  return {
    ...raw,
    tags: parseTags(raw.tags),
    notebooklm_links,
    notebooklm_url: notebooklm_links.at(-1)?.url ?? raw.notebooklm_url,
    raw_metadata,
  }
}

function openDb(readonly = false) {
  return new Database(getDbPath(), { readonly, fileMustExist: true })
}

export function listLinkedInSavedPage(
  query: ListPageQuery,
): ListPage<ReturnType<typeof formatLinkedInSavedRow>> {
  const db = openDb(true)
  try {
    const filters = buildCommonFilters(query, {
      deletedAt: true,
      notebookLinksColumn: 'notebooklm_links',
      searchColumns: {
        title: 'title',
        tags: 'tags',
        extra: [
          'author_name',
          'content_text',
          'summary_text',
          'linkedin_urn',
          'source_url',
          'linkedin_url',
        ],
      },
    })
    const where = whereSql(filters.clauses)
    const orderBy = buildOrderBy(query.sort, query.pinsAtTop)
    const offset = decodeCursor(query.cursor)?.offset ?? 0

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM linkedin_saved_items ${where}`)
        .get(...filters.values) as { count: number }
    ).count

    const tags = collectTagsFromRows(
      db
        .prepare(`SELECT tags FROM linkedin_saved_items WHERE deleted_at IS NULL`)
        .all() as { tags: string }[],
    )

    const rows = db
      .prepare(
        `
      SELECT ${LINKEDIN_COLUMNS}
      FROM linkedin_saved_items
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...filters.values, query.limit, offset) as RawLinkedInSavedRow[]

    const nextOffset = offset + rows.length
    return {
      items: rows.map(formatLinkedInSavedRow),
      nextCursor: nextOffset < total ? encodeCursor({ offset: nextOffset }) : null,
      tags,
      total,
    }
  } finally {
    db.close()
  }
}

export function patchLinkedInSaved(id: number, payload: LinkedInSavedPatchPayload) {
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
    if (!Array.isArray(payload.tags) || !payload.tags.every((t) => typeof t === 'string')) {
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
      const current = db
        .prepare(
          `
        SELECT notebooklm_links FROM linkedin_saved_items
        WHERE id = ? AND deleted_at IS NULL
      `,
        )
        .get(id) as { notebooklm_links: string } | undefined
      if (!current) {
        return { ok: false as const, status: 404, error: 'LinkedIn item not found' }
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

    const result = db
      .prepare(
        `
      UPDATE linkedin_saved_items
      SET ${sets.join(', ')}
      WHERE id = ? AND deleted_at IS NULL
    `,
      )
      .run(...values, id)

    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'LinkedIn item not found' }
    }

    const row = db
      .prepare(
        `
      SELECT ${LINKEDIN_COLUMNS}
      FROM linkedin_saved_items
      WHERE id = ?
    `,
      )
      .get(id) as RawLinkedInSavedRow

    return { ok: true as const, row: formatLinkedInSavedRow(row) }
  } finally {
    db.close()
  }
}

export function softDeleteLinkedInSaved(id: number) {
  const db = openDb()
  try {
    const result = db
      .prepare(
        `
      UPDATE linkedin_saved_items
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
      )
      .run(new Date().toISOString(), new Date().toISOString(), id)
    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'LinkedIn item not found' }
    }
    return { ok: true as const }
  } finally {
    db.close()
  }
}
