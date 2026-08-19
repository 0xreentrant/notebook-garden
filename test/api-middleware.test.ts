import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../src/server/api-middleware'
import { createHarness, insertEntry, type Harness } from './helpers/harness'

function listen() {
  const server = createServer((req, res) => {
    apiMiddleware(req, res, () => {
      res.statusCode = 204
      res.setHeader('X-Fell-Through', '1')
      res.end()
    })
  })
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('no port')
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    })
  })
}

describe('api middleware adapter', () => {
  let h: Harness
  let baseUrl: string
  let close: () => Promise<void>

  beforeEach(async () => {
    h = createHarness()
    const listening = await listen()
    baseUrl = listening.baseUrl
    close = listening.close
  })

  afterEach(async () => {
    await close()
    h.cleanup()
  })

  it('serves health through the Node-to-Fetch bridge', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('forwards query strings on list pages', async () => {
    insertEntry(h.dbPath, { video_id: 'a', title: 'A', created_at: '2026-01-01T00:00:00.000Z' })
    insertEntry(h.dbPath, { video_id: 'b', title: 'B', created_at: '2026-01-02T00:00:00.000Z' })
    const page = await (await fetch(`${baseUrl}/api/entries?limit=1`)).json()
    expect(page.items).toHaveLength(1)
    expect(page.items[0].video_id).toBe('b')
    expect(page.nextCursor).toBeTruthy()
  })

  it('serves entry detail with full transcript text', async () => {
    const transcript = 'Full transcript here'
    const id = insertEntry(h.dbPath, {
      video_id: 'detail',
      title: 'Detail',
      transcript_text: transcript,
    })
    const detail = await (await fetch(`${baseUrl}/api/entries/${id}`)).json()
    expect(detail.transcript_text).toBe(transcript)
  })

  it('streams a JSON PATCH body through the adapter', async () => {
    const id = insertEntry(h.dbPath, { video_id: 'patch', title: 'Patch me' })
    const res = await fetch(`${baseUrl}/api/entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).pinned).toBe(1)
  })

  it('falls through non-API paths to next()', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(204)
    expect(res.headers.get('X-Fell-Through')).toBe('1')
  })
})
