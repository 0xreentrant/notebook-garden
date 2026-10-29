import Database from 'better-sqlite3'
import { getDbPath } from '../db/paths'
import type { ListPage, ListPageQuery } from '../lib/list-page'
import { LIST_TEXT_PREVIEW_CHARS } from '../lib/list-page'
import {
  appendNotebookLink,
  parseNotebookLinks,
  serializeNotebookLinks,
  type NotebookLink,
} from '../lib/notebook-links'
import { parseTags, serializeTags } from '../lib/tags'
import { NOTEBOOKLM_URL_PREFIX } from './entries-api'
import type { MappedRedditSaved } from './reddit-client'
import {
  buildCommonFilters,
  buildOrderBy,
  collectTagsFromRows,
  decodeCursor,
  encodeCursor,
  tagsForPage,
  whereSql,
} from './list-page'

export const REDDIT_COLUMNS = `
  id, reddit_name, kind, title, url, permalink, subreddit, author,
  content_text, over_18, notebooklm_url, notebooklm_links, last_viewed,
  pinned, tags, created_at, updated_at, deleted_at
`

export const REDDIT_LIST_COLUMNS = `
  id, reddit_name, kind, title, url, permalink, subreddit, author,
  substr(content_text, 1, ${LIST_TEXT_PREVIEW_CHARS}) as content_text,
  (length(COALESCE(content_text, '')) > ${LIST_TEXT_PREVIEW_CHARS}) AS text_overflow,
  over_18, notebooklm_url, notebooklm_links, last_viewed,
  pinned, tags, created_at, updated_at, deleted_at
`

export type RawRedditSavedRow = {
  id: number
  reddit_name: string
  kind: 'link' | 'comment'
  title: string
  url: string
  permalink: string
  subreddit: string
  author: string
  content_text: string | null
  text_overflow?: number
  over_18: number
  notebooklm_url: string | null
  notebooklm_links: string
  last_viewed: string | null
  pinned: number
  tags: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type RedditSavedPatchPayload = {
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

export function formatRedditSavedRow(raw: RawRedditSavedRow) {
  const notebooklm_links = parseNotebookLinks(raw.notebooklm_links)
  return {
    ...raw,
    tags: parseTags(raw.tags),
    notebooklm_links,
    notebooklm_url: notebooklm_links.at(-1)?.url ?? raw.notebooklm_url,
    text_overflow: Boolean(raw.text_overflow),
  }
}

function openDb(readonly = false) {
  return new Database(getDbPath(), { readonly, fileMustExist: true })
}

export function upsertRedditSavedItems(items: MappedRedditSaved[]) {
  const db = openDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO reddit_saved_items (
      reddit_name, kind, title, url, permalink, subreddit, author,
      content_text, over_18, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reddit_name) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      url = excluded.url,
      permalink = excluded.permalink,
      subreddit = excluded.subreddit,
      author = excluded.author,
      content_text = excluded.content_text,
      over_18 = excluded.over_18,
      updated_at = excluded.updated_at
    WHERE reddit_saved_items.deleted_at IS NULL
  `)
  const tx = db.transaction((rows: MappedRedditSaved[]) => {
    for (const row of rows) {
      stmt.run(
        row.reddit_name,
        row.kind,
        row.title,
        row.url,
        row.permalink,
        row.subreddit,
        row.author,
        row.content_text,
        row.over_18,
        row.created_at,
        now,
      )
    }
  })
  try {
    tx(items)
    return { upserted: items.length }
  } finally {
    db.close()
  }
}

export function listRedditSavedPage(
  query: ListPageQuery,
): ListPage<ReturnType<typeof formatRedditSavedRow>> {
  const db = openDb(true)
  try {
    const filters = buildCommonFilters(query, {
      deletedAt: true,
      notebookLinksColumn: 'notebooklm_links',
      searchColumns: {
        title: 'title',
        tags: 'tags',
        extra: ['author', 'content_text', 'subreddit', 'permalink', 'url', 'reddit_name'],
      },
    })
    const where = whereSql(filters.clauses)
    const orderBy = buildOrderBy(query.sort, query.pinsAtTop)
    const offset = decodeCursor(query.cursor)?.offset ?? 0

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM reddit_saved_items ${where}`)
        .get(...filters.values) as { count: number }
    ).count

    const tags = tagsForPage(query.cursor, () =>
      collectTagsFromRows(
        db
          .prepare(`SELECT tags FROM reddit_saved_items WHERE deleted_at IS NULL`)
          .all() as { tags: string }[],
      ),
    )

    const rows = db
      .prepare(
        `
      SELECT ${REDDIT_LIST_COLUMNS}
      FROM reddit_saved_items
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...filters.values, query.limit, offset) as RawRedditSavedRow[]

    const nextOffset = offset + rows.length
    return {
      items: rows.map(formatRedditSavedRow),
      nextCursor: nextOffset < total ? encodeCursor({ offset: nextOffset }) : null,
      tags,
      total,
    }
  } finally {
    db.close()
  }
}

export function patchRedditSaved(id: number, payload: RedditSavedPatchPayload) {
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
        error: `notebooklm_url must start with ${NOTEBOOKLM_URL_PREFIX}`,
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
        SELECT notebooklm_links FROM reddit_saved_items
        WHERE id = ? AND deleted_at IS NULL
      `,
        )
        .get(id) as { notebooklm_links: string } | undefined
      if (!current) {
        return { ok: false as const, status: 404, error: 'Reddit item not found' }
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
      UPDATE reddit_saved_items
      SET ${sets.join(', ')}
      WHERE id = ? AND deleted_at IS NULL
    `,
      )
      .run(...values, id)

    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'Reddit item not found' }
    }

    const row = db
      .prepare(
        `
      SELECT ${REDDIT_LIST_COLUMNS}
      FROM reddit_saved_items
      WHERE id = ?
    `,
      )
      .get(id) as RawRedditSavedRow

    return { ok: true as const, row: formatRedditSavedRow(row) }
  } finally {
    db.close()
  }
}

export function getRedditSaved(id: number) {
  const db = openDb(true)
  try {
    const row = db
      .prepare(
        `
      SELECT ${REDDIT_COLUMNS}
      FROM reddit_saved_items
      WHERE id = ? AND deleted_at IS NULL
    `,
      )
      .get(id) as RawRedditSavedRow | undefined
    if (!row) return { ok: false as const, status: 404, error: 'Reddit item not found' }
    return { ok: true as const, row: formatRedditSavedRow(row) }
  } finally {
    db.close()
  }
}

export function softDeleteRedditSaved(id: number) {
  const db = openDb()
  try {
    const result = db
      .prepare(
        `
      UPDATE reddit_saved_items
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
      )
      .run(new Date().toISOString(), new Date().toISOString(), id)
    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'Reddit item not found' }
    }
    return { ok: true as const }
  } finally {
    db.close()
  }
}
