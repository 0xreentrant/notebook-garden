import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { truncateNotebookTitle } from '../src/lib/notebook-links'
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

describe('7. Cross-view contracts', () => {
  let h: Harness

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withNotebooklmCookie.mockImplementation(async (fn) => fn('test-cookie'))
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('makes planted notebooks visible in Library without a manual remote sync', async () => {
    const entryId = insertEntry(h.dbPath, {
      title: 'Plant me',
      url: 'https://www.youtube.com/watch?v=plant',
    })
    const bookmarkId = insertBookmark(h.dbPath, {
      title: 'Plant bookmark',
      url: 'https://example.com/plant',
    })
    const linkedInId = insertLinkedIn(h.dbPath, {
      title: 'Plant LI',
      source_url: 'https://example.com/li-plant',
    })

    const ids = [
      'a1111111-1111-4111-8111-111111111111',
      'a2222222-2222-4222-8222-222222222222',
      'a3333333-3333-4333-8333-333333333333',
    ]

    for (const [index, [title, url, patchPath]] of [
      ['Plant me', 'https://www.youtube.com/watch?v=plant', `/api/entries/${entryId}`],
      ['Plant bookmark', 'https://example.com/plant', `/api/bookmarks/${bookmarkId}`],
      ['Plant LI', 'https://example.com/li-plant', `/api/linkedin-saved/${linkedInId}`],
    ].entries()) {
      const id = ids[index]
      mocks.createAndImportViaApi.mockResolvedValueOnce({
        notebookId: id,
        notebookUrl: notebookUrl(id),
      })
      await request(h.app, 'http://localhost/api/notebooklm/create-and-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url }),
      })
      await request(h.app, `http://localhost${patchPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebooklm_link: { url: notebookUrl(id), title } }),
      })
    }

    const library = await (await request(h.app, 'http://localhost/api/notebooks?limit=50')).json()
    const planted = new Set(library.items.map((n: { notebooklm_id: string }) => n.notebooklm_id))
    for (const id of ids) expect(planted.has(id)).toBe(true)
  })

  it('keeps notebook link history with latest URL primary and truncated display titles', async () => {
    const first = 'b1111111-1111-4111-8111-111111111111'
    const second = 'b2222222-2222-4222-8222-222222222222'
    const entryId = insertEntry(h.dbPath, { video_id: 'hist', title: 'History' })

    await request(h.app, `http://localhost/api/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: {
          url: notebookUrl(first),
          title: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        },
      }),
    })
    const afterSecond = await request(h.app, `http://localhost/api/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl(second), title: 'Second notebook' },
      }),
    })
    const entry = await afterSecond.json()
    expect(entry.notebooklm_links).toEqual([
      { url: notebookUrl(first), title: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
      { url: notebookUrl(second), title: 'Second notebook' },
    ])
    expect(entry.notebooklm_url).toBe(notebookUrl(second))
    expect(truncateNotebookTitle(entry.notebooklm_links[0].title)).toBe(
      'ABCDEFGHIJKLMNOPQRSTUVWXY…',
    )
    expect(entry.notebooklm_links[0].url).toBe(notebookUrl(first))
  })

  it('keeps list namespaces independent across tabs', async () => {
    insertEntry(h.dbPath, { video_id: 'only-entry', title: 'Entry only', tags: '["e"]' })
    insertBookmark(h.dbPath, {
      url: 'https://example.com/only-bookmark',
      title: 'Bookmark only',
      tags: '["b"]',
    })
    insertLinkedIn(h.dbPath, { title: 'LinkedIn only', tags: '["l"]' })
    insertNotebook(h.dbPath, { title: 'Notebook only', tags: '["n"]' })

    const entries = await (await request(h.app, 'http://localhost/api/entries?tag=e')).json()
    const bookmarks = await (await request(h.app, 'http://localhost/api/bookmarks?tag=b')).json()
    const linkedin = await (
      await request(h.app, 'http://localhost/api/linkedin-saved?tag=l')
    ).json()
    const notebooks = await (await request(h.app, 'http://localhost/api/notebooks?tag=n')).json()

    expect(entries.total).toBe(1)
    expect(entries.items[0].title).toBe('Entry only')
    expect(bookmarks.total).toBe(1)
    expect(bookmarks.items[0].title).toBe('Bookmark only')
    expect(linkedin.total).toBe(1)
    expect(linkedin.items[0].title).toBe('LinkedIn only')
    expect(notebooks.total).toBe(1)
    expect(notebooks.items[0].title).toBe('Notebook only')
  })
})
