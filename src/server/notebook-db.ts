import Database from 'better-sqlite3'
import { getDbPath } from '../db/paths'
import { notInArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { notebooks } from '../db/schema'
import type { ListPage, ListPageQuery } from '../lib/list-page'
import { parseTags } from '../lib/tags'
import type { NotebookRow, NotebookSyncPayload } from '../types'
import {
  buildCommonFilters,
  buildOrderBy,
  collectTagsFromRows,
  decodeCursor,
  encodeCursor,
  whereSql,
} from './list-page'

export { getDbPath } from '../db/paths'

function formatNotebookRow(raw: {
  id: number
  notebooklm_id: string
  title: string
  url: string
  last_viewed: string | null
  pinned: number
  tags: string
  source_count: number
  created_at: string
}): NotebookRow {
  return {
    id: raw.id,
    notebooklm_id: raw.notebooklm_id,
    title: raw.title,
    url: raw.url,
    last_viewed: raw.last_viewed,
    pinned: raw.pinned,
    tags: parseTags(raw.tags),
    source_count: raw.source_count,
    created_at: raw.created_at,
  }
}

function withDb<T>(fn: (db: ReturnType<typeof drizzle>) => T): T {
  const sqlite = new Database(getDbPath())
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { notebooks } })
  try {
    return fn(db)
  } finally {
    sqlite.close()
  }
}

function upsertNotebookItemInDb(db: ReturnType<typeof drizzle>, item: NotebookSyncPayload) {
  const createdAt = item.created_at ?? new Date().toISOString()
  db.insert(notebooks)
    .values({
      notebooklmId: item.notebooklmId,
      title: item.title,
      url: item.url,
      createdAt,
      lastViewed: item.last_viewed ?? null,
      sourceCount: item.source_count ?? 0,
    })
    .onConflictDoUpdate({
      target: notebooks.notebooklmId,
      set: {
        title: item.title,
        url: item.url,
        ...(item.created_at != null ? { createdAt: item.created_at } : {}),
        lastViewed: item.last_viewed ?? null,
        ...(item.source_count != null ? { sourceCount: item.source_count } : {}),
      },
    })
    .run()
}

export function upsertNotebookItem(item: NotebookSyncPayload) {
  withDb((db) => {
    upsertNotebookItemInDb(db, item)
  })
}

export function upsertNotebooks(items: NotebookSyncPayload[]) {
  withDb((db) => {
    for (const item of items) {
      upsertNotebookItemInDb(db, item)
    }

    const remoteIds = items.map((item) => item.notebooklmId)
    if (remoteIds.length === 0) {
      db.delete(notebooks).run()
    } else {
      db.delete(notebooks).where(notInArray(notebooks.notebooklmId, remoteIds)).run()
    }
  })
}

export function listCachedNotebooks(): NotebookRow[] {
  return withDb((db) => {
    const rows = db.select().from(notebooks).all()
    return rows.map((row) => formatNotebookRow({
      id: row.id,
      notebooklm_id: row.notebooklmId,
      title: row.title,
      url: row.url,
      last_viewed: row.lastViewed,
      pinned: row.pinned,
      tags: row.tags,
      source_count: row.sourceCount,
      created_at: row.createdAt,
    }))
  })
}

export function listCachedNotebooksPage(query: ListPageQuery): ListPage<NotebookRow> {
  const sqlite = new Database(getDbPath(), { readonly: true, fileMustExist: true })
  try {
    const filters = buildCommonFilters(query, {
      searchColumns: { title: 'title', tags: 'tags' },
    })
    const where = whereSql(filters.clauses)
    const orderBy = buildOrderBy(query.sort, query.pinsAtTop)
    const offset = decodeCursor(query.cursor)?.offset ?? 0

    const total = (sqlite.prepare(`
      SELECT COUNT(*) AS count FROM notebooks ${where}
    `).get(...filters.values) as { count: number }).count

    const tags = collectTagsFromRows(
      sqlite.prepare(`SELECT tags FROM notebooks`).all() as { tags: string }[],
    )

    const rows = sqlite.prepare(`
      SELECT id, notebooklm_id, title, url, last_viewed, pinned, tags, source_count, created_at
      FROM notebooks
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...filters.values, query.limit, offset) as {
      id: number
      notebooklm_id: string
      title: string
      url: string
      last_viewed: string | null
      pinned: number
      tags: string
      source_count: number
      created_at: string
    }[]

    const nextOffset = offset + rows.length
    return {
      items: rows.map(formatNotebookRow),
      nextCursor: nextOffset < total ? encodeCursor({ offset: nextOffset }) : null,
      tags,
      total,
    }
  } finally {
    sqlite.close()
  }
}
