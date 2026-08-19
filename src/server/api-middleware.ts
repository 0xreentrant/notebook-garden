import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { getRequestListener } from '@hono/node-server'
import { createApp } from '../../server/app'

const listener = getRequestListener(createApp().fetch)

export function apiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
) {
  if (!req.url?.startsWith('/api/')) {
    next()
    return
  }
  void listener(req, res)
}
