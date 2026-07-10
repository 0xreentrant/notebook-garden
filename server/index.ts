import { serve } from '@hono/node-server'
import { createApp } from './app'

const port = Number(process.env.PORT || 3002)
const hostname = process.env.HOST || '127.0.0.1'

serve({ fetch: createApp().fetch, port, hostname }, () => {
  console.log(`notebook-garden api listening on http://${hostname}:${port}`)
})
