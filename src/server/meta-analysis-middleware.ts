import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { generateMetaAnalysis, getLatestMetaAnalysis } from './meta-analysis-api'
import { readJsonBody, sendJson } from './http-utils'

export function metaAnalysisMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    try {
      sendJson(res, 200, getLatestMetaAnalysis())
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (req.method === 'POST' && (pathname === '/' || pathname === '')) {
    void (async () => {
      let force = false
      try {
        const body = (await readJsonBody(req)) as { force?: unknown }
        force = body?.force === true
      } catch {
        // empty body is fine
      }
      try {
        sendJson(res, 200, generateMetaAnalysis({ force }))
      } catch (error) {
        sendJson(res, 500, { error: String(error) })
      }
    })()
    return
  }

  next()
}
