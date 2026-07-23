import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHarness,
  insertBookmark,
  insertEntry,
  insertLinkedIn,
  insertNotebook,
  notebookUrl,
  request,
  type Harness,
} from './helpers/harness'

const mocks = vi.hoisted(() => ({
  withNotebooklmCookie: vi.fn(async <T>(fn: (cookie: string) => Promise<T>) => fn('test-cookie')),
  createAndImportViaApi: vi.fn(),
  bulkCreateAndImportViaApi: vi.fn(),
  addYouTubeSourcesViaApi: vi.fn(),
  createNotebookViaApi: vi.fn(),
  fetchNotebookListFromApi: vi.fn(),
  renameNotebookViaApi: vi.fn(),
  deleteNotebookViaApi: vi.fn(),
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
    bulkCreateAndImportViaApi: mocks.bulkCreateAndImportViaApi,
    addYouTubeSourcesViaApi: mocks.addYouTubeSourcesViaApi,
    createNotebookViaApi: mocks.createNotebookViaApi,
    fetchNotebookListFromApi: mocks.fetchNotebookListFromApi,
    renameNotebookViaApi: mocks.renameNotebookViaApi,
    deleteNotebookViaApi: mocks.deleteNotebookViaApi,
  }
})

describe('1. Planting notebooks', () => {
  let h: Harness

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withNotebooklmCookie.mockImplementation(async (fn) => fn('test-cookie'))
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('creates a notebook from a summary and lands it in Library', async () => {
    const entryId = insertEntry(h.dbPath, {
      title: 'Soil science',
      url: 'https://www.youtube.com/watch?v=soil1',
    })
    const id = '11111111-1111-4111-8111-111111111111'
    mocks.createAndImportViaApi.mockResolvedValue({
      notebookId: id,
      notebookUrl: notebookUrl(id),
    })

    const created = await request(h.app, 'http://localhost/api/notebooklm/create-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Soil science', url: 'https://www.youtube.com/watch?v=soil1' }),
    })
    expect(created.status).toBe(200)
    const payload = await created.json()
    expect(payload.notebookUrl).toBe(notebookUrl(id))

    const patched = await request(h.app, `http://localhost/api/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl(id), title: 'Soil science' },
      }),
    })
    expect(patched.status).toBe(200)
    const entry = await patched.json()
    expect(entry.notebooklm_links).toEqual([{ url: notebookUrl(id), title: 'Soil science' }])
    expect(entry.notebooklm_url).toBe(notebookUrl(id))

    const library = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(library.items.some((n: { notebooklm_id: string }) => n.notebooklm_id === id)).toBe(true)
  })

  it('creates a notebook from a bookmark and lands it in Library', async () => {
    const bookmarkId = insertBookmark(h.dbPath, {
      title: 'Essay',
      url: 'https://example.com/essay',
    })
    const id = '22222222-2222-4222-8222-222222222222'
    mocks.createAndImportViaApi.mockResolvedValue({
      notebookId: id,
      notebookUrl: notebookUrl(id),
    })

    const created = await request(h.app, 'http://localhost/api/notebooklm/create-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Essay', url: 'https://example.com/essay' }),
    })
    expect(created.status).toBe(200)

    const patched = await request(h.app, `http://localhost/api/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl(id), title: 'Essay' },
      }),
    })
    const row = await patched.json()
    expect(row.notebooklm_links).toEqual([{ url: notebookUrl(id), title: 'Essay' }])

    const library = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(library.items.some((n: { notebooklm_id: string }) => n.notebooklm_id === id)).toBe(true)
  })

  it('creates a notebook from a LinkedIn saved item and lands it in Library', async () => {
    const itemId = insertLinkedIn(h.dbPath, {
      title: 'Career post',
      source_url: 'https://example.com/career',
    })
    const id = '33333333-3333-4333-8333-333333333333'
    mocks.createAndImportViaApi.mockResolvedValue({
      notebookId: id,
      notebookUrl: notebookUrl(id),
    })

    await request(h.app, 'http://localhost/api/notebooklm/create-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Career post', url: 'https://example.com/career' }),
    })

    const patched = await request(h.app, `http://localhost/api/linkedin-saved/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl(id), title: 'Career post' },
      }),
    })
    const row = await patched.json()
    expect(row.notebooklm_links).toEqual([{ url: notebookUrl(id), title: 'Career post' }])

    const library = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(library.items.some((n: { notebooklm_id: string }) => n.notebooklm_id === id)).toBe(true)
  })

  it('bulk-creates one notebook for selected summaries and bookmarks', async () => {
    const entryId = insertEntry(h.dbPath, {
      title: 'A',
      url: 'https://www.youtube.com/watch?v=aaaa',
    })
    const bookmarkId = insertBookmark(h.dbPath, {
      title: 'B',
      url: 'https://example.com/b',
    })
    const id = '44444444-4444-4444-8444-444444444444'
    mocks.bulkCreateAndImportViaApi.mockResolvedValue({
      notebookId: id,
      notebookUrl: notebookUrl(id),
    })

    const created = await request(h.app, 'http://localhost/api/notebooklm/bulk-create-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Imported videos (2)',
        urls: ['https://www.youtube.com/watch?v=aaaa', 'https://example.com/b'],
      }),
    })
    expect(created.status).toBe(200)

    for (const [path, title] of [
      [`/api/entries/${entryId}`, 'A'],
      [`/api/bookmarks/${bookmarkId}`, 'B'],
    ] as const) {
      const patched = await request(h.app, `http://localhost${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebooklm_link: { url: notebookUrl(id), title: 'Imported videos (2)' },
        }),
      })
      const row = await patched.json()
      expect(row.notebooklm_url).toBe(notebookUrl(id))
      expect(row.notebooklm_links.at(-1).title).toBe('Imported videos (2)')
      expect(title).toBeTruthy()
    }

    const library = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    const notebook = library.items.find((n: { notebooklm_id: string }) => n.notebooklm_id === id)
    expect(notebook?.source_count).toBe(2)
  })

  it('adds selected items to an existing notebook and updates duplicate link titles', async () => {
    const existingId = '55555555-5555-4555-8555-555555555555'
    insertNotebook(h.dbPath, {
      notebooklm_id: existingId,
      title: 'Garden',
      source_count: 1,
    })
    const entryId = insertEntry(h.dbPath, {
      title: 'Extra',
      url: 'https://www.youtube.com/watch?v=extra',
      notebooklm_links: JSON.stringify([{ url: notebookUrl(existingId), title: 'Old title' }]),
      notebooklm_url: notebookUrl(existingId),
    })
    mocks.addYouTubeSourcesViaApi.mockResolvedValue(undefined)

    const added = await request(h.app, 'http://localhost/api/notebooklm/add-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklmId: existingId,
        urls: ['https://www.youtube.com/watch?v=extra'],
      }),
    })
    expect(added.status).toBe(200)

    const patched = await request(h.app, `http://localhost/api/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl(existingId), title: 'Garden renamed' },
      }),
    })
    const entry = await patched.json()
    expect(entry.notebooklm_links).toEqual([
      { url: notebookUrl(existingId), title: 'Garden renamed' },
    ])

    const library = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    const notebook = library.items.find(
      (n: { notebooklm_id: string }) => n.notebooklm_id === existingId,
    )
    expect(notebook?.source_count).toBe(2)
  })

  it('creates an empty Library notebook that appears after sync', async () => {
    const id = '66666666-6666-4666-8666-666666666666'
    mocks.createNotebookViaApi.mockResolvedValue(id)
    mocks.fetchNotebookListFromApi.mockResolvedValue([
      {
        notebooklmId: id,
        title: 'Untitled notebook',
        url: notebookUrl(id),
        created_at: '2026-06-01T00:00:00.000Z',
        last_viewed: null,
        source_count: 0,
      },
    ])

    const created = await request(h.app, 'http://localhost/api/notebooks/remote/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled notebook' }),
    })
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({ notebooklmId: id })

    const synced = await request(h.app, 'http://localhost/api/notebooks/sync', { method: 'POST' })
    expect(synced.status).toBe(200)
    const notebooks = await synced.json()
    expect(notebooks.some((n: { notebooklm_id: string }) => n.notebooklm_id === id)).toBe(true)
  })

  it('surfaces auth failure without writing local notebook state', async () => {
    const { NOTEBOOKLM_AUTH_ERROR } = await import('../src/server/notebooklm/notebooklm-auth')
    mocks.withNotebooklmCookie.mockRejectedValue(new Error(NOTEBOOKLM_AUTH_ERROR))

    const before = await (await request(h.app, 'http://localhost/api/notebooks')).json()

    const create = await request(h.app, 'http://localhost/api/notebooklm/create-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope', url: 'https://www.youtube.com/watch?v=nope' }),
    })
    expect(create.status).toBe(500)
    expect((await create.json()).error).toContain('Not logged into NotebookLM')

    const sync = await request(h.app, 'http://localhost/api/notebooks/sync', { method: 'POST' })
    expect(sync.status).toBe(401)

    const rename = await request(h.app, 'http://localhost/api/notebooks/remote/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebooklmId: 'x', title: 'Y' }),
    })
    expect(rename.status).toBe(401)

    const del = await request(h.app, 'http://localhost/api/notebooks/remote/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebooklmId: 'x' }),
    })
    expect(del.status).toBe(401)

    const after = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(after.total).toBe(before.total)
  })
})
