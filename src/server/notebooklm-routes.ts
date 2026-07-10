import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { upsertNotebooks } from './notebook-db'
import { withNotebooklmCookie } from './notebooklm/notebooklm-auth'
import {
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
    upsertNotebooks([summary])
    return { success: true, ...result }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function createNotebooklmImport(title: string, url: string): Promise<CreateNotebookResult> {
  const task = notebooklmQueue.then(() => runNotebooklmImport(title, url))
  notebooklmQueue = task.then(() => {}, () => {})
  return task
}

export async function createNotebooklmHandler(req: IncomingMessage, res: ServerResponse) {
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

  next()
}

export function notebookUrlForId(notebooklmId: string) {
  return `${NOTEBOOK_URL_PREFIX}${notebooklmId}`
}
