import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import Database from 'better-sqlite3'
import { parseTags, serializeTags } from '../lib/tags'
import { readJsonBody, sendJson } from './http-utils'
import type { NotebookSummary } from './notebooklm/notebooklm'
import {
  createNotebookViaApi,
  deleteNotebookViaApi,
  NOTEBOOKLM_DEFAULT_TITLE,
  NOTEBOOK_URL_PREFIX,
  renameNotebookViaApi,
} from './notebooklm/notebooklm'
import { parseListPageQuery } from '../lib/list-page'
import {
  getDbPath,
  listCachedNotebooks,
  listCachedNotebooksPage,
  upsertNotebooks,
} from './notebook-db'
import { NOTEBOOKLM_AUTH_ERROR, withNotebooklmCookie } from './notebooklm/notebooklm-auth'
import { syncRemoteNotebooksToCache } from './sync-remote'

const NOTEBOOK_COLUMNS = `
  id, notebooklm_id, title, url, last_viewed, pinned, tags, source_count, created_at
`

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
}) {
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

function isNotebookSummary(value: unknown): value is NotebookSummary {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (
    typeof row.notebooklmId !== 'string'
    || typeof row.title !== 'string'
    || typeof row.url !== 'string'
  ) {
    return false
  }
  if (row.created_at != null && typeof row.created_at !== 'string') return false
  if (row.last_viewed != null && typeof row.last_viewed !== 'string') return false
  if (row.source_count != null && typeof row.source_count !== 'number') return false
  return true
}

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message === NOTEBOOKLM_AUTH_ERROR || message.includes('Not authorized')) {
    return { statusCode: 401 as const, error: NOTEBOOKLM_AUTH_ERROR }
  }
  return { statusCode: 502 as const, error: message }
}

function getNotebooks(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    sendJson(
      res,
      200,
      listCachedNotebooksPage(
        parseListPageQuery(url.searchParams, { allowNotebookFilter: false }),
      ),
    )
  } catch (error) {
    sendJson(res, 500, { error: String(error) })
  }
}

async function syncNotebooks(req: IncomingMessage, res: ServerResponse) {
  let body: unknown = {}
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { notebooks?: unknown }
  if (Array.isArray(payload.notebooks)) {
    const remote = payload.notebooks.filter(isNotebookSummary)
    upsertNotebooks(remote)
    sendJson(res, 200, listCachedNotebooks())
    return
  }

  try {
    sendJson(res, 200, await syncRemoteNotebooksToCache())
  } catch (error) {
    const { statusCode, error: message } = authErrorResponse(error)
    sendJson(res, statusCode, { error: message })
  }
}

async function patchNotebook(req: IncomingMessage, res: ServerResponse, id: number) {
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as {
    last_viewed?: unknown
    pinned?: unknown
    tags?: unknown
    title?: unknown
  }

  const sets: string[] = []
  const values: unknown[] = []

  if (payload.title !== undefined) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      sendJson(res, 400, { error: 'title must be a non-empty string' })
      return
    }
    sets.push('title = ?')
    values.push(payload.title.trim())
  }

  if (payload.last_viewed === true) {
    sets.push('last_viewed = ?')
    values.push(new Date().toISOString())
  }

  if (payload.pinned !== undefined) {
    if (typeof payload.pinned !== 'boolean') {
      sendJson(res, 400, { error: 'pinned must be a boolean' })
      return
    }
    sets.push('pinned = ?')
    values.push(payload.pinned ? 1 : 0)
  }

  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags)) {
      sendJson(res, 400, { error: 'tags must be an array of strings' })
      return
    }
    if (!payload.tags.every((tag) => typeof tag === 'string')) {
      sendJson(res, 400, { error: 'tags must be an array of strings' })
      return
    }
    sets.push('tags = ?')
    values.push(serializeTags(payload.tags))
  }

  if (sets.length === 0) {
    sendJson(res, 400, { error: 'No valid fields to update' })
    return
  }

  const sqlite = new Database(getDbPath())
  try {
    const result = sqlite.prepare(`
      UPDATE notebooks
      SET ${sets.join(', ')}
      WHERE id = ?
    `).run(...values, id)

    if (result.changes === 0) {
      sendJson(res, 404, { error: 'Notebook not found' })
      return
    }

    const row = sqlite.prepare(`
      SELECT ${NOTEBOOK_COLUMNS}
      FROM notebooks
      WHERE id = ?
    `).get(id) as {
      id: number
      notebooklm_id: string
      title: string
      url: string
      last_viewed: string | null
      pinned: number
      tags: string
      source_count: number
      created_at: string
    }

    sendJson(res, 200, formatNotebookRow(row))
  } catch (error) {
    sendJson(res, 500, { error: String(error) })
  } finally {
    sqlite.close()
  }
}

function deleteNotebook(_req: IncomingMessage, res: ServerResponse, id: number) {
  const sqlite = new Database(getDbPath())
  try {
    const result = sqlite.prepare('DELETE FROM notebooks WHERE id = ?').run(id)
    if (result.changes === 0) {
      sendJson(res, 404, { error: 'Notebook not found' })
      return
    }
    res.statusCode = 204
    res.end()
  } catch (error) {
    sendJson(res, 500, { error: String(error) })
  } finally {
    sqlite.close()
  }
}

async function remoteRename(req: IncomingMessage, res: ServerResponse) {
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { notebooklmId?: unknown; title?: unknown }
  if (typeof payload.notebooklmId !== 'string' || !payload.notebooklmId) {
    sendJson(res, 400, { error: 'notebooklmId is required' })
    return
  }
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    sendJson(res, 400, { error: 'title is required' })
    return
  }

  try {
    await withNotebooklmCookie((cookie) =>
      renameNotebookViaApi(cookie, payload.notebooklmId as string, (payload.title as string).trim()),
    )
    sendJson(res, 200, { ok: true })
  } catch (error) {
    const { statusCode, error: message } = authErrorResponse(error)
    sendJson(res, statusCode, { error: message })
  }
}

async function remoteDelete(req: IncomingMessage, res: ServerResponse) {
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { notebooklmId?: unknown }
  if (typeof payload.notebooklmId !== 'string' || !payload.notebooklmId) {
    sendJson(res, 400, { error: 'notebooklmId is required' })
    return
  }

  try {
    await withNotebooklmCookie((cookie) =>
      deleteNotebookViaApi(cookie, payload.notebooklmId as string),
    )
    sendJson(res, 200, { ok: true })
  } catch (error) {
    const { statusCode, error: message } = authErrorResponse(error)
    sendJson(res, statusCode, { error: message })
  }
}

async function remoteCreate(req: IncomingMessage, res: ServerResponse) {
  let body: unknown = {}
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { title?: unknown }
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : NOTEBOOKLM_DEFAULT_TITLE

  try {
    const notebooklmId = await withNotebooklmCookie((cookie) => createNotebookViaApi(cookie, title))
    sendJson(res, 200, {
      notebooklmId,
      title,
      url: `${NOTEBOOK_URL_PREFIX}${notebooklmId}`,
    })
  } catch (error) {
    const { statusCode, error: message } = authErrorResponse(error)
    sendJson(res, statusCode, { error: message })
  }
}

export function notebooksApiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const pathname = (req.url ?? '/').split('?')[0]
  const idMatch = pathname.match(/^\/(\d+)\/?$/)

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    getNotebooks(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/sync') {
    void syncNotebooks(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/remote/rename') {
    void remoteRename(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/remote/delete') {
    void remoteDelete(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/remote/create') {
    void remoteCreate(req, res)
    return
  }

  if (req.method === 'PATCH' && idMatch) {
    void patchNotebook(req, res, Number(idMatch[1]))
    return
  }

  if (req.method === 'DELETE' && idMatch) {
    deleteNotebook(req, res, Number(idMatch[1]))
    return
  }

  next()
}
