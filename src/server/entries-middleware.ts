import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { parseListPageQuery } from '../lib/list-page'
import { listEntriesPage, patchEntry, softDeleteEntry } from './entries-api'
import { readJsonBody, sendJson } from './http-utils'

export function entriesMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  const idMatch = pathname.match(/^\/(\d+)\/?$/)

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    try {
      sendJson(res, 200, listEntriesPage(parseListPageQuery(url.searchParams)))
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (req.method === 'DELETE' && idMatch) {
    try {
      const result = softDeleteEntry(Number(idMatch[1]))
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error })
        return
      }
      res.statusCode = 204
      res.end()
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (req.method === 'PATCH' && idMatch) {
    void (async () => {
      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' })
        return
      }

      try {
        const result = patchEntry(Number(idMatch[1]), body as Parameters<typeof patchEntry>[1])
        if (!result.ok) {
          sendJson(res, result.status, { error: result.error })
          return
        }
        sendJson(res, 200, result.row)
      } catch (error) {
        sendJson(res, 500, { error: String(error) })
      }
    })()
    return
  }

  next()
}
