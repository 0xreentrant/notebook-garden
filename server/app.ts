import { Hono } from 'hono'
import Database from 'better-sqlite3'
import { parseTags, serializeTags } from '../src/lib/tags'
import { parseListPageQuery } from '../src/lib/list-page'
import {
  listEntriesPage,
  patchEntry,
  softDeleteEntry,
} from '../src/server/entries-api'
import {
  listBookmarksPage,
  patchBookmark,
  softDeleteBookmark,
  syncBookmarksFromChrome,
} from '../src/server/bookmarks-api'
import {
  getDbPath,
  listCachedNotebooks,
  listCachedNotebooksPage,
  upsertNotebooks,
} from '../src/server/notebook-db'
import { createNotebooklmImport, createNotebooklmBulkImport, addSourcesToNotebooklm } from '../src/server/notebooklm-routes'
import {
  generateMetaAnalysis,
  getLatestMetaAnalysis,
} from '../src/server/meta-analysis-api'
import {
  createNotebookViaApi,
  deleteNotebookViaApi,
  NOTEBOOKLM_DEFAULT_TITLE,
  NOTEBOOK_URL_PREFIX,
  renameNotebookViaApi,
  type NotebookSummary,
} from '../src/server/notebooklm/notebooklm'
import { NOTEBOOKLM_AUTH_ERROR, withNotebooklmCookie } from '../src/server/notebooklm/notebooklm-auth'
import { syncRemoteNotebooksToCache } from '../src/server/sync-remote'

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
    ...raw,
    tags: parseTags(raw.tags),
  }
}

function authErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message === NOTEBOOKLM_AUTH_ERROR || message.includes('Not authorized')) {
    return { status: 401 as const, error: NOTEBOOKLM_AUTH_ERROR }
  }
  return { status: 502 as const, error: message }
}

function isNotebookSummary(value: unknown): value is NotebookSummary {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.notebooklmId === 'string'
    && typeof row.title === 'string'
    && typeof row.url === 'string'
}

export function createApp() {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/meta-analysis', (c) => {
    try {
      return c.json(getLatestMetaAnalysis())
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.post('/api/meta-analysis', async (c) => {
    let force = false
    try {
      const body = await c.req.json<{ force?: unknown }>()
      force = body?.force === true
    } catch {
      // empty body ok
    }
    try {
      const result = generateMetaAnalysis({ force })
      if (result.error) return c.json(result, 502)
      return c.json(result)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.get('/api/entries', (c) => {
    try {
      return c.json(listEntriesPage(parseListPageQuery(new URL(c.req.url).searchParams)))
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.patch('/api/entries/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    try {
      const result = patchEntry(id, body as Parameters<typeof patchEntry>[1])
      if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404)
      return c.json(result.row)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.delete('/api/entries/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    try {
      const result = softDeleteEntry(id)
      if (!result.ok) return c.json({ error: result.error }, 404)
      return c.body(null, 204)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.get('/api/bookmarks', (c) => {
    try {
      return c.json(listBookmarksPage(parseListPageQuery(new URL(c.req.url).searchParams)))
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.post('/api/bookmarks/sync', (c) => {
    try {
      return c.json(syncBookmarksFromChrome())
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.patch('/api/bookmarks/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    try {
      const result = patchBookmark(id, body as Parameters<typeof patchBookmark>[1])
      if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404)
      return c.json(result.row)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.delete('/api/bookmarks/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    try {
      const result = softDeleteBookmark(id)
      if (!result.ok) return c.json({ error: result.error }, 404)
      return c.body(null, 204)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.post('/api/notebooklm/create-and-import', async (c) => {
    let body: { title?: unknown; url?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ error: 'title is required' }, 400)
    }
    if (typeof body.url !== 'string' || !body.url.trim().startsWith('http')) {
      return c.json({ error: 'url is required' }, 400)
    }

    try {
      const result = await createNotebooklmImport(body.title.trim(), body.url.trim())
      if (result.error || !result.notebookUrl) {
        return c.json({ error: result.error ?? 'Failed to create notebook' }, 500)
      }
      return c.json(result)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.post('/api/notebooklm/bulk-create-and-import', async (c) => {
    let body: { title?: unknown; urls?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ error: 'title is required' }, 400)
    }
    const urls = Array.isArray(body.urls)
      ? body.urls
          .filter((url): url is string => typeof url === 'string' && url.trim().startsWith('http'))
          .map((url) => url.trim())
      : []
    if (urls.length === 0) {
      return c.json({ error: 'urls must be a non-empty array of http URLs' }, 400)
    }

    try {
      const result = await createNotebooklmBulkImport(body.title.trim(), urls)
      if (result.error || !result.notebookUrl) {
        return c.json({ error: result.error ?? 'Failed to create notebook' }, 500)
      }
      return c.json(result)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.post('/api/notebooklm/add-sources', async (c) => {
    let body: { notebooklmId?: unknown; urls?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (typeof body.notebooklmId !== 'string' || !body.notebooklmId.trim()) {
      return c.json({ error: 'notebooklmId is required' }, 400)
    }
    const urls = Array.isArray(body.urls)
      ? body.urls
          .filter((url): url is string => typeof url === 'string' && url.trim().startsWith('http'))
          .map((url) => url.trim())
      : []
    if (urls.length === 0) {
      return c.json({ error: 'urls must be a non-empty array of http URLs' }, 400)
    }

    try {
      const result = await addSourcesToNotebooklm(body.notebooklmId.trim(), urls)
      if (result.error || !result.notebookUrl) {
        return c.json({ error: result.error ?? 'Failed to add sources' }, 500)
      }
      return c.json(result)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.get('/api/notebooks', (c) => {
    try {
      return c.json(
        listCachedNotebooksPage(
          parseListPageQuery(new URL(c.req.url).searchParams, {
            allowNotebookFilter: false,
          }),
        ),
      )
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    }
  })

  app.post('/api/notebooks/sync', async (c) => {
    let body: { notebooks?: unknown } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    if (Array.isArray(body.notebooks)) {
      upsertNotebooks(body.notebooks.filter(isNotebookSummary))
      return c.json(listCachedNotebooks())
    }

    try {
      return c.json(await syncRemoteNotebooksToCache())
    } catch (error) {
      const { status, error: message } = authErrorStatus(error)
      return c.json({ error: message }, status)
    }
  })

  app.patch('/api/notebooks/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    let payload: {
      last_viewed?: unknown
      pinned?: unknown
      tags?: unknown
      title?: unknown
    }
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const sets: string[] = []
    const values: unknown[] = []

    if (payload.title !== undefined) {
      if (typeof payload.title !== 'string' || !payload.title.trim()) {
        return c.json({ error: 'title must be a non-empty string' }, 400)
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
        return c.json({ error: 'pinned must be a boolean' }, 400)
      }
      sets.push('pinned = ?')
      values.push(payload.pinned ? 1 : 0)
    }
    if (payload.tags !== undefined) {
      if (!Array.isArray(payload.tags) || !payload.tags.every((t) => typeof t === 'string')) {
        return c.json({ error: 'tags must be an array of strings' }, 400)
      }
      sets.push('tags = ?')
      values.push(serializeTags(payload.tags))
    }
    if (sets.length === 0) return c.json({ error: 'No valid fields to update' }, 400)

    const sqlite = new Database(getDbPath())
    try {
      const result = sqlite.prepare(`UPDATE notebooks SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
      if (result.changes === 0) return c.json({ error: 'Notebook not found' }, 404)
      const row = sqlite.prepare(`SELECT ${NOTEBOOK_COLUMNS} FROM notebooks WHERE id = ?`).get(id)
      return c.json(formatNotebookRow(row as Parameters<typeof formatNotebookRow>[0]))
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    } finally {
      sqlite.close()
    }
  })

  app.delete('/api/notebooks/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400)

    const sqlite = new Database(getDbPath())
    try {
      const result = sqlite.prepare('DELETE FROM notebooks WHERE id = ?').run(id)
      if (result.changes === 0) return c.json({ error: 'Notebook not found' }, 404)
      return c.body(null, 204)
    } catch (error) {
      return c.json({ error: String(error) }, 500)
    } finally {
      sqlite.close()
    }
  })

  app.post('/api/notebooks/remote/rename', async (c) => {
    const body = await c.req.json<{ notebooklmId?: string; title?: string }>()
    if (!body.notebooklmId || !body.title?.trim()) {
      return c.json({ error: 'notebooklmId and title are required' }, 400)
    }
    try {
      await withNotebooklmCookie((cookie) =>
        renameNotebookViaApi(cookie, body.notebooklmId!, body.title!.trim()),
      )
      return c.json({ ok: true })
    } catch (error) {
      const { status, error: message } = authErrorStatus(error)
      return c.json({ error: message }, status)
    }
  })

  app.post('/api/notebooks/remote/delete', async (c) => {
    const body = await c.req.json<{ notebooklmId?: string }>()
    if (!body.notebooklmId) return c.json({ error: 'notebooklmId is required' }, 400)
    try {
      await withNotebooklmCookie((cookie) => deleteNotebookViaApi(cookie, body.notebooklmId!))
      return c.json({ ok: true })
    } catch (error) {
      const { status, error: message } = authErrorStatus(error)
      return c.json({ error: message }, status)
    }
  })

  app.post('/api/notebooks/remote/create', async (c) => {
    let body: { title?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const title = body.title?.trim() || NOTEBOOKLM_DEFAULT_TITLE
    try {
      const notebooklmId = await withNotebooklmCookie((cookie) => createNotebookViaApi(cookie, title))
      return c.json({ notebooklmId, title, url: `${NOTEBOOK_URL_PREFIX}${notebooklmId}` })
    } catch (error) {
      const { status, error: message } = authErrorStatus(error)
      return c.json({ error: message }, status)
    }
  })

  return app
}
