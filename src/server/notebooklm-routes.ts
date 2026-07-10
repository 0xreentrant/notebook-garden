import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { listCachedNotebooks, upsertNotebookItem } from './notebook-db'
import { withNotebooklmCookie } from './notebooklm/notebooklm-auth'
import {
  addYouTubeSourcesViaApi,
  bulkCreateAndImportViaApi,
  createAndImportViaApi,
  NOTEBOOK_URL_PREFIX,
  type NotebookSummary,
} from './notebooklm/notebooklm'
import { readJsonBody, sendJson } from './http-utils'

export type CreateNotebookResult = {
  success?: boolean
  notebookId?: string
  notebookUrl?: string
  error?: string
}

let notebooklmQueue: Promise<unknown> = Promise.resolve()

function enqueueNotebooklmTask<T>(task: () => Promise<T>): Promise<T> {
  const run = notebooklmQueue.then(task)
  notebooklmQueue = run.then(() => {}, () => {})
  return run
}

function parseHttpUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const urls = value
    .filter((url): url is string => typeof url === 'string' && url.trim().startsWith('http'))
    .map((url) => url.trim())
  return urls.length > 0 ? urls : null
}

function cacheNotebookSummary(summary: NotebookSummary) {
  upsertNotebookItem(summary)
}

export async function runNotebooklmImport(title: string, url: string): Promise<CreateNotebookResult> {
  try {
    const result = await withNotebooklmCookie((cookie) => createAndImportViaApi(cookie, title, url))
    const summary: NotebookSummary = {
      notebooklmId: result.notebookId,
      title,
      url: result.notebookUrl,
      created_at: new Date().toISOString(),
      last_viewed: null,
      source_count: 1,
    }
    cacheNotebookSummary(summary)
    return { success: true, ...result }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runBulkNotebooklmImport(
  title: string,
  urls: string[],
): Promise<CreateNotebookResult> {
  try {
    const result = await withNotebooklmCookie((cookie) =>
      bulkCreateAndImportViaApi(cookie, title, urls),
    )
    cacheNotebookSummary({
      notebooklmId: result.notebookId,
      title,
      url: result.notebookUrl,
      created_at: new Date().toISOString(),
      last_viewed: null,
      source_count: urls.length,
    })
    return { success: true, ...result }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runAddSourcesToNotebook(
  notebooklmId: string,
  urls: string[],
): Promise<{ success?: boolean; notebookUrl?: string; error?: string }> {
  try {
    await withNotebooklmCookie((cookie) => addYouTubeSourcesViaApi(cookie, notebooklmId, urls))
    const cached = listCachedNotebooks().find((notebook) => notebook.notebooklm_id === notebooklmId)
    const notebookUrl = cached?.url ?? `${NOTEBOOK_URL_PREFIX}${notebooklmId}`
    cacheNotebookSummary({
      notebooklmId,
      title: cached?.title ?? 'Notebook',
      url: notebookUrl,
      created_at: cached?.created_at ?? null,
      last_viewed: cached?.last_viewed ?? null,
      source_count: (cached?.source_count ?? 0) + urls.length,
    })
    return { success: true, notebookUrl }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function createNotebooklmImport(title: string, url: string): Promise<CreateNotebookResult> {
  return enqueueNotebooklmTask(() => runNotebooklmImport(title, url))
}

export async function createNotebooklmBulkImport(
  title: string,
  urls: string[],
): Promise<CreateNotebookResult> {
  return enqueueNotebooklmTask(() => runBulkNotebooklmImport(title, urls))
}

export async function addSourcesToNotebooklm(
  notebooklmId: string,
  urls: string[],
): Promise<{ success?: boolean; notebookUrl?: string; error?: string }> {
  return enqueueNotebooklmTask(() => runAddSourcesToNotebook(notebooklmId, urls))
}

async function createNotebooklmHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { title?: unknown; url?: unknown }
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    sendJson(res, 400, { error: 'title is required' })
    return
  }
  if (typeof payload.url !== 'string' || !payload.url.trim().startsWith('http')) {
    sendJson(res, 400, { error: 'url is required' })
    return
  }

  const result = await createNotebooklmImport(payload.title.trim(), payload.url.trim())
  if (result.error || !result.notebookUrl) {
    sendJson(res, 500, { error: result.error ?? 'Failed to create notebook' })
    return
  }

  sendJson(res, 200, result)
}

async function bulkCreateNotebooklmHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { title?: unknown; urls?: unknown }
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    sendJson(res, 400, { error: 'title is required' })
    return
  }
  const urls = parseHttpUrls(payload.urls)
  if (!urls) {
    sendJson(res, 400, { error: 'urls must be a non-empty array of http URLs' })
    return
  }

  const result = await createNotebooklmBulkImport(payload.title.trim(), urls)
  if (result.error || !result.notebookUrl) {
    sendJson(res, 500, { error: result.error ?? 'Failed to create notebook' })
    return
  }

  sendJson(res, 200, result)
}

async function addSourcesNotebooklmHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const payload = body as { notebooklmId?: unknown; urls?: unknown }
  if (typeof payload.notebooklmId !== 'string' || !payload.notebooklmId.trim()) {
    sendJson(res, 400, { error: 'notebooklmId is required' })
    return
  }
  const urls = parseHttpUrls(payload.urls)
  if (!urls) {
    sendJson(res, 400, { error: 'urls must be a non-empty array of http URLs' })
    return
  }

  const result = await addSourcesToNotebooklm(payload.notebooklmId.trim(), urls)
  if (result.error || !result.notebookUrl) {
    sendJson(res, 500, { error: result.error ?? 'Failed to add sources' })
    return
  }

  sendJson(res, 200, result)
}

export function notebooklmMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const pathname = (req.url ?? '/').split('?')[0]
  if (pathname === '/create-and-import' || pathname === '/create-and-import/') {
    void createNotebooklmHandler(req, res)
    return
  }
  if (pathname === '/bulk-create-and-import' || pathname === '/bulk-create-and-import/') {
    void bulkCreateNotebooklmHandler(req, res)
    return
  }
  if (pathname === '/add-sources' || pathname === '/add-sources/') {
    void addSourcesNotebooklmHandler(req, res)
    return
  }

  next()
}

export function notebookUrlForId(notebooklmId: string) {
  return `${NOTEBOOK_URL_PREFIX}${notebooklmId}`
}
