import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { parseListPageQuery } from '../lib/list-page'
import {
  listLinkedInSavedPage,
  patchLinkedInSaved,
  softDeleteLinkedInSaved,
} from './linkedin-saved-api'
import { readJsonBody, sendJson } from './http-utils'

export function linkedinSavedMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  const idMatch = pathname.match(/^\/(\d+)\/?$/)

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    try {
      sendJson(res, 200, listLinkedInSavedPage(parseListPageQuery(url.searchParams)))
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (req.method === 'DELETE' && idMatch) {
    try {
      const result = softDeleteLinkedInSaved(Number(idMatch[1]))
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
        const result = patchLinkedInSaved(
          Number(idMatch[1]),
          body as Parameters<typeof patchLinkedInSaved>[1],
        )
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
