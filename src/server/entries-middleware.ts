import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { listEntries, patchEntry, softDeleteEntry } from './entries-api'
import { readJsonBody, sendJson } from './http-utils'

export function entriesMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const pathname = (req.url ?? '/').split('?')[0]
  const idMatch = pathname.match(/^\/(\d+)\/?$/)

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    try {
      sendJson(res, 200, listEntries())
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
