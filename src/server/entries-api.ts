import Database from 'better-sqlite3'
import { getDbPath } from '../db/paths'
import { parseTags, serializeTags } from '../lib/tags'

export const NOTEBOOKLM_URL_PREFIX = 'https://notebooklm.google.com/notebook/'

export const ENTRY_COLUMNS = `
  id, video_id, title, url, status, skip_backfill,
  error_message, summary_text, notebooklm_url, last_viewed, pinned, tags, created_at, updated_at, deleted_at
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
  notebooklm_url: string | null
  last_viewed: string | null
  pinned: number
  tags: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type EntryPatchPayload = {
  notebooklm_url?: unknown
  last_viewed?: unknown
  pinned?: unknown
  tags?: unknown
}

export { getDbPath } from '../db/paths'

export function formatEntryRow(raw: RawEntryRow) {
  return {
    ...raw,
    tags: parseTags(raw.tags),
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

export function patchEntry(id: number, payload: EntryPatchPayload) {
  const sets: string[] = []
  const values: unknown[] = []

  if (payload.notebooklm_url !== undefined) {
    if (
      typeof payload.notebooklm_url !== 'string' ||
      !payload.notebooklm_url.startsWith(NOTEBOOKLM_URL_PREFIX)
    ) {
      return { ok: false as const, status: 400, error: 'notebooklm_url must start with https://notebooklm.google.com/notebook/' }
    }
    sets.push('notebooklm_url = ?', 'updated_at = ?')
    values.push(payload.notebooklm_url, new Date().toISOString())
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

  if (sets.length === 0) {
    return { ok: false as const, status: 400, error: 'No valid fields to update' }
  }

  const db = openDb()
  try {
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
