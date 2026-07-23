import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHarness,
  insertNotebook,
  notebookUrl,
  request,
  type Harness,
} from './helpers/harness'

const mocks = vi.hoisted(() => ({
  withNotebooklmCookie: vi.fn(async <T>(fn: (cookie: string) => Promise<T>) => fn('test-cookie')),
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
    fetchNotebookListFromApi: mocks.fetchNotebookListFromApi,
    renameNotebookViaApi: mocks.renameNotebookViaApi,
    deleteNotebookViaApi: mocks.deleteNotebookViaApi,
  }
})

describe('2. Library tending', () => {
  let h: Harness

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withNotebooklmCookie.mockImplementation(async (fn) => fn('test-cookie'))
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('remote sync refreshes metadata and prunes missing notebooks', async () => {
    const keepId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const dropId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    insertNotebook(h.dbPath, {
      notebooklm_id: keepId,
      title: 'Old title',
      source_count: 1,
    })
    insertNotebook(h.dbPath, {
      notebooklm_id: dropId,
      title: 'Gone remotely',
      source_count: 3,
    })

    mocks.fetchNotebookListFromApi.mockResolvedValue([
      {
        notebooklmId: keepId,
        title: 'New title',
        url: notebookUrl(keepId),
        created_at: '2026-01-01T00:00:00.000Z',
        last_viewed: null,
        source_count: 5,
      },
    ])

    const synced = await request(h.app, 'http://localhost/api/notebooks/sync', { method: 'POST' })
    expect(synced.status).toBe(200)
    const rows = await synced.json()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      notebooklm_id: keepId,
      title: 'New title',
      source_count: 5,
    })
  })

  it('preserves pins and tags across sync upsert', async () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const localId = insertNotebook(h.dbPath, {
      notebooklm_id: id,
      title: 'Local',
      pinned: 1,
      tags: '["garden","soil"]',
      source_count: 1,
    })

    await request(h.app, `http://localhost/api/notebooks/${localId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true, tags: ['garden', 'soil'] }),
    })

    mocks.fetchNotebookListFromApi.mockResolvedValue([
      {
        notebooklmId: id,
        title: 'Remote title',
        url: notebookUrl(id),
        created_at: '2026-01-01T00:00:00.000Z',
        last_viewed: null,
        source_count: 9,
      },
    ])

    const synced = await (await request(h.app, 'http://localhost/api/notebooks/sync', {
      method: 'POST',
    })).json()
    expect(synced[0]).toMatchObject({
      notebooklm_id: id,
      title: 'Remote title',
      pinned: 1,
      tags: ['garden', 'soil'],
      source_count: 9,
    })
  })

  it('renames a notebook remotely and locally', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const rowId = insertNotebook(h.dbPath, { notebooklm_id: id, title: 'Before' })
    mocks.renameNotebookViaApi.mockResolvedValue(undefined)

    const remote = await request(h.app, 'http://localhost/api/notebooks/remote/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebooklmId: id, title: 'After' }),
    })
    expect(remote.status).toBe(200)

    const local = await request(h.app, `http://localhost/api/notebooks/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'After' }),
    })
    expect(local.status).toBe(200)
    expect((await local.json()).title).toBe('After')
    expect(mocks.renameNotebookViaApi).toHaveBeenCalledWith('test-cookie', id, 'After')
  })

  it('deletes a notebook remotely and from local cache', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const rowId = insertNotebook(h.dbPath, { notebooklm_id: id, title: 'Delete me' })
    mocks.deleteNotebookViaApi.mockResolvedValue(undefined)

    const remote = await request(h.app, 'http://localhost/api/notebooks/remote/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebooklmId: id }),
    })
    expect(remote.status).toBe(200)

    const local = await request(h.app, `http://localhost/api/notebooks/${rowId}`, {
      method: 'DELETE',
    })
    expect(local.status).toBe(204)

    const list = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(list.total).toBe(0)
  })

  it('pins and unpins a notebook across reload', async () => {
    const rowId = insertNotebook(h.dbPath, { title: 'Pin me' })

    const pinned = await request(h.app, `http://localhost/api/notebooks/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    })
    expect((await pinned.json()).pinned).toBe(1)

    const listed = await (await request(h.app, 'http://localhost/api/notebooks')).json()
    expect(listed.items[0].pinned).toBe(1)

    const unpinned = await request(h.app, `http://localhost/api/notebooks/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: false }),
    })
    expect((await unpinned.json()).pinned).toBe(0)
  })

  it('adds and removes notebook tags and keeps tag filter consistent', async () => {
    const a = insertNotebook(h.dbPath, { title: 'A', tags: '[]' })
    insertNotebook(h.dbPath, { title: 'B', tags: '["other"]' })

    await request(h.app, `http://localhost/api/notebooks/${a}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['soil'] }),
    })

    const filtered = await (
      await request(h.app, 'http://localhost/api/notebooks?tag=soil&limit=50')
    ).json()
    expect(filtered.total).toBe(1)
    expect(filtered.items[0].title).toBe('A')
    expect(filtered.tags).toEqual(expect.arrayContaining(['soil', 'other']))

    await request(h.app, `http://localhost/api/notebooks/${a}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [] }),
    })

    const after = await (
      await request(h.app, 'http://localhost/api/notebooks?tag=soil&limit=50')
    ).json()
    expect(after.total).toBe(0)
  })

  it('bulk pin, tag, and delete only touch selected notebooks', async () => {
    const keep = insertNotebook(h.dbPath, { title: 'Keep', tags: '[]' })
    const change = insertNotebook(h.dbPath, { title: 'Change', tags: '[]' })
    const remove = insertNotebook(h.dbPath, { title: 'Remove', tags: '[]' })

    await request(h.app, `http://localhost/api/notebooks/${change}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true, tags: ['bulk'] }),
    })
    await request(h.app, `http://localhost/api/notebooks/${remove}`, { method: 'DELETE' })

    const list = await (await request(h.app, 'http://localhost/api/notebooks?limit=50')).json()
    expect(list.total).toBe(2)
    const byId = Object.fromEntries(
      list.items.map((n: { id: number; title: string; pinned: number; tags: string[] }) => [
        n.id,
        n,
      ]),
    )
    expect(byId[keep]).toMatchObject({ pinned: 0, tags: [] })
    expect(byId[change]).toMatchObject({ pinned: 1, tags: ['bulk'] })
    expect(byId[remove]).toBeUndefined()
  })
})
