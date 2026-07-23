import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { getSettings, putSettings } from './settings-api'
import { readJsonBody, sendJson } from './http-utils'

export function settingsMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    try {
      sendJson(res, 200, getSettings())
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (req.method === 'PUT' && (pathname === '/' || pathname === '')) {
    void (async () => {
      try {
        const body = (await readJsonBody(req)) as { obsidianVault?: unknown }
        if (body.obsidianVault !== undefined && typeof body.obsidianVault !== 'string') {
          sendJson(res, 400, { error: 'obsidianVault must be a string' })
          return
        }
        sendJson(
          res,
          200,
          putSettings({
            obsidianVault: typeof body.obsidianVault === 'string' ? body.obsidianVault : undefined,
          }),
        )
      } catch (error) {
        sendJson(res, 500, { error: String(error) })
      }
    })()
    return
  }

  next()
}
