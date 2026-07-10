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
import { collectChromeBookmarks } from './chrome-bookmarks'
import { NOTEBOOKLM_URL_PREFIX } from './entries-api'
import {
  buildCommonFilters,
  buildOrderBy,
  collectTagsFromRows,
  decodeCursor,
  encodeCursor,
  whereSql,
} from './list-page'

export const BOOKMARK_COLUMNS = `
  id, url, title, folder_path, chrome_profile,
  notebooklm_url, notebooklm_links, last_viewed, pinned, tags,
  created_at, updated_at, deleted_at
`

export type RawBookmarkRow = {
  id: number
  url: string
  title: string
  folder_path: string
  chrome_profile: string
  notebooklm_url: string | null
  notebooklm_links: string
  last_viewed: string | null
  pinned: number
  tags: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type BookmarkPatchPayload = {
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

export function formatBookmarkRow(raw: RawBookmarkRow) {
  const notebooklm_links = parseNotebookLinks(raw.notebooklm_links)
  return {
    ...raw,
    tags: parseTags(raw.tags),
    notebooklm_links,
    notebooklm_url: notebooklm_links.at(-1)?.url ?? raw.notebooklm_url,
  }
}

function openDb(readonly = false) {
  return new Database(getDbPath(), { readonly, fileMustExist: true })
}

export function listBookmarks() {
  const db = openDb(true)
  try {
    const rows = db.prepare(`
      SELECT ${BOOKMARK_COLUMNS}
      FROM bookmarks
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
    `).all() as RawBookmarkRow[]
    return rows.map(formatBookmarkRow)
  } finally {
    db.close()
  }
}

export function listBookmarksPage(query: ListPageQuery): ListPage<ReturnType<typeof formatBookmarkRow>> {
  const db = openDb(true)
  try {
    const filters = buildCommonFilters(query, {
      deletedAt: true,
      notebookLinksColumn: 'notebooklm_links',
      searchColumns: {
        title: 'title',
        tags: 'tags',
        extra: ['folder_path', 'chrome_profile', 'url'],
      },
    })
    const where = whereSql(filters.clauses)
    const orderBy = buildOrderBy(query.sort, query.pinsAtTop)
    const offset = decodeCursor(query.cursor)?.offset ?? 0

    const total = (db.prepare(`
      SELECT COUNT(*) AS count FROM bookmarks ${where}
    `).get(...filters.values) as { count: number }).count

    const tags = collectTagsFromRows(
      db.prepare(`SELECT tags FROM bookmarks WHERE deleted_at IS NULL`).all() as { tags: string }[],
    )

    const rows = db.prepare(`
      SELECT ${BOOKMARK_COLUMNS}
      FROM bookmarks
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...filters.values, query.limit, offset) as RawBookmarkRow[]

    const nextOffset = offset + rows.length
    return {
      items: rows.map(formatBookmarkRow),
      nextCursor: nextOffset < total ? encodeCursor({ offset: nextOffset }) : null,
      tags,
      total,
    }
  } finally {
    db.close()
  }
}

export function syncBookmarksFromChrome(userDataDir?: string) {
  const { bookmarks, profiles } = collectChromeBookmarks(userDataDir)
  const db = openDb()
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO bookmarks (
        url, title, folder_path, chrome_profile,
        notebooklm_links, pinned, tags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '[]', 0, '[]', ?, ?)
    `)

    const now = new Date().toISOString()
    let inserted = 0
    const run = db.transaction(() => {
      for (const bookmark of bookmarks) {
        const result = insert.run(
          bookmark.url,
          bookmark.title,
          bookmark.folder_path,
          bookmark.chrome_profile,
          now,
          now,
        )
        if (result.changes > 0) inserted += 1
      }
    })
    run()

    return {
      inserted,
      skipped: bookmarks.length - inserted,
      profiles,
      total_seen: bookmarks.length,
    }
  } finally {
    db.close()
  }
}

export function patchBookmark(id: number, payload: BookmarkPatchPayload) {
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
        SELECT notebooklm_links FROM bookmarks
        WHERE id = ? AND deleted_at IS NULL
      `).get(id) as { notebooklm_links: string } | undefined
      if (!current) {
        return { ok: false as const, status: 404, error: 'Bookmark not found' }
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
      UPDATE bookmarks
      SET ${sets.join(', ')}
      WHERE id = ? AND deleted_at IS NULL
    `).run(...values, id)

    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'Bookmark not found' }
    }

    const row = db.prepare(`
      SELECT ${BOOKMARK_COLUMNS}
      FROM bookmarks
      WHERE id = ?
    `).get(id) as RawBookmarkRow | undefined

    return { ok: true as const, row: row ? formatBookmarkRow(row) : null }
  } finally {
    db.close()
  }
}

export function softDeleteBookmark(id: number) {
  const db = openDb()
  try {
    const now = new Date().toISOString()
    const result = db.prepare(`
      UPDATE bookmarks
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(now, now, id)

    if (result.changes === 0) {
      return { ok: false as const, status: 404, error: 'Bookmark not found' }
    }

    return { ok: true as const }
  } finally {
    db.close()
  }
}
