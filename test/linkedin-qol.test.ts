import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHarness,
  insertLinkedIn,
  notebookUrl,
  request,
  type Harness,
} from './helpers/harness'

const mocks = vi.hoisted(() => ({
  withNotebooklmCookie: vi.fn(async <T>(fn: (cookie: string) => Promise<T>) => fn('test-cookie')),
  createAndImportViaApi: vi.fn(),
}))

vi.mock('../src/server/notebooklm/notebooklm-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/notebooklm/notebooklm-auth')>()
  return {
    ...actual,
    withNotebooklmCookie: mocks.withNotebooklmCookie,
  }
})

vi.mock('../src/server/notebooklm/notebooklm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/notebooklm/notebooklm')>()
  return {
    ...actual,
    createAndImportViaApi: mocks.createAndImportViaApi,
  }
})

describe('5. LinkedIn Saved QoL', () => {
  let h: Harness

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withNotebooklmCookie.mockImplementation(async (fn) => fn('test-cookie'))
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('browses and searches by title, author, and text', async () => {
    insertLinkedIn(h.dbPath, {
      title: 'Hiring signal',
      author_name: 'Ada Lovelace',
      content_text: 'compilers and gardens',
    })
    insertLinkedIn(h.dbPath, {
      title: 'Other',
      author_name: 'Bob',
      content_text: 'unrelated',
    })

    expect(
      (await (await request(h.app, 'http://localhost/api/linkedin-saved?search=hiring')).json())
        .total,
    ).toBe(1)
    expect(
      (await (await request(h.app, 'http://localhost/api/linkedin-saved?search=ada')).json())
        .total,
    ).toBe(1)
    expect(
      (
        await (
          await request(h.app, 'http://localhost/api/linkedin-saved?search=compilers')
        ).json()
      ).total,
    ).toBe(1)
  })

  it('pins, marks viewed, and soft-deletes', async () => {
    const id = insertLinkedIn(h.dbPath, { title: 'Persist me', content_text: 'body' })

    const pinned = await request(h.app, `http://localhost/api/linkedin-saved/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    expect((await pinned.json()).pinned).toBe(1)

    const viewed = await request(h.app, `http://localhost/api/linkedin-saved/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_viewed: true }),
    })
    expect((await viewed.json()).last_viewed).toBeTruthy()

    const del = await request(h.app, `http://localhost/api/linkedin-saved/${id}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(204)

    const list = await (await request(h.app, 'http://localhost/api/linkedin-saved')).json()
    expect(list.total).toBe(0)
  })

  it('exposes content_text for the copy-content action', async () => {
    insertLinkedIn(h.dbPath, {
      title: 'Copy me',
      content_text: 'Exact clipboard payload',
    })
    const list = await (await request(h.app, 'http://localhost/api/linkedin-saved')).json()
    expect(list.items[0].content_text).toBe('Exact clipboard payload')
  })

  it('creates a notebook from an item with link persistence and library upsert', async () => {
    const itemId = insertLinkedIn(h.dbPath, {
      title: 'Source post',
      source_url: 'https://example.com/li-source',
      content_text: 'body',
    })
    const id = '99999999-9999-4999-8999-999999999999'
    mocks.createAndImportViaApi.mockResolvedValue({
      notebookId: id,
      notebookUrl: notebookUrl(id),
    })

    const created = await request(h.app, 'http://localhost/api/notebooklm/create-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Source post', url: 'https://example.com/li-source' }),
    })
    expect(created.status).toBe(200)

    const patched = await request(h.app, `http://localhost/api/linkedin-saved/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl(id), title: 'Source post' },
      }),
    })
    expect((await patched.json()).notebooklm_url).toBe(notebookUrl(id))

    const library = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(library.items.some((n: { notebooklm_id: string }) => n.notebooklm_id === id)).toBe(true)
  })
})
