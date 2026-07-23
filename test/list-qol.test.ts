import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PINS_AT_TOP_KEY as ENTRY_PINS_KEY,
  readPinsAtTop as readEntryPinsAtTop,
} from '../src/lib/entry-list'
import {
  PINS_AT_TOP_KEY as NOTEBOOK_PINS_KEY,
  readPinsAtTop as readNotebookPinsAtTop,
} from '../src/lib/notebook-list'
import {
  BOOKMARK_PINS_AT_TOP_KEY,
  readBookmarkPinsAtTop,
} from '../src/lib/bookmark-list'
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

describe('3. Shared list QoL', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('pages entries without duplicates or skips', async () => {
    insertEntry(h.dbPath, { video_id: 'a', title: 'A', created_at: '2026-01-01T00:00:00.000Z' })
    insertEntry(h.dbPath, { video_id: 'b', title: 'B', created_at: '2026-01-02T00:00:00.000Z' })
    insertEntry(h.dbPath, { video_id: 'c', title: 'C', created_at: '2026-01-03T00:00:00.000Z' })

    const first = await (await request(h.app, 'http://localhost/api/entries?limit=2')).json()
    expect(first.items.map((e: { video_id: string }) => e.video_id)).toEqual(['c', 'b'])
    expect(first.nextCursor).toBeTruthy()

    const second = await (
      await request(h.app, `http://localhost/api/entries?limit=2&cursor=${first.nextCursor}`)
    ).json()
    expect(second.items.map((e: { video_id: string }) => e.video_id)).toEqual(['a'])
    expect(second.nextCursor).toBeNull()
  })

  it('searches with title/tags scopes', async () => {
    insertEntry(h.dbPath, {
      video_id: 't1',
      title: 'Compost basics',
      tags: '["soil"]',
    })
    insertEntry(h.dbPath, {
      video_id: 't2',
      title: 'Other',
      tags: '["compost"]',
    })

    const all = await (
      await request(h.app, 'http://localhost/api/entries?search=compost&searchScope=all&limit=50')
    ).json()
    expect(all.total).toBe(2)

    const titles = await (
      await request(
        h.app,
        'http://localhost/api/entries?search=compost&searchScope=title&limit=50',
      )
    ).json()
    expect(titles.total).toBe(1)
    expect(titles.items[0].title).toBe('Compost basics')

    const tags = await (
      await request(h.app, 'http://localhost/api/entries?search=compost&searchScope=tags&limit=50')
    ).json()
    expect(tags.total).toBe(1)
    expect(tags.items[0].title).toBe('Other')
  })

  it('filters by viewed state, notebook presence, and tag', async () => {
    insertEntry(h.dbPath, {
      video_id: 'v1',
      title: 'Never',
      last_viewed: null,
      tags: '["soil"]',
    })
    insertEntry(h.dbPath, {
      video_id: 'v2',
      title: 'Seen',
      last_viewed: '2026-02-01T00:00:00.000Z',
      notebooklm_links: JSON.stringify([{ url: notebookUrl('x'), title: 'N' }]),
      tags: '["soil"]',
    })
    insertEntry(h.dbPath, {
      video_id: 'v3',
      title: 'Other tag',
      tags: '["water"]',
    })

    expect(
      (await (await request(h.app, 'http://localhost/api/entries?view=never_viewed')).json())
        .total,
    ).toBe(2)
    expect(
      (await (await request(h.app, 'http://localhost/api/entries?view=viewed')).json()).total,
    ).toBe(1)
    expect(
      (
        await (
          await request(h.app, 'http://localhost/api/entries?notebook=with_notebook')
        ).json()
      ).total,
    ).toBe(1)
    expect(
      (
        await (
          await request(h.app, 'http://localhost/api/entries?notebook=without_notebook')
        ).json()
      ).total,
    ).toBe(2)
    expect(
      (await (await request(h.app, 'http://localhost/api/entries?tag=soil')).json()).total,
    ).toBe(2)
  })

  it('sorts by created and viewed with stable ties', async () => {
    insertEntry(h.dbPath, {
      video_id: 's1',
      title: 'First',
      created_at: '2026-01-01T00:00:00.000Z',
      last_viewed: '2026-03-01T00:00:00.000Z',
    })
    insertEntry(h.dbPath, {
      video_id: 's2',
      title: 'Second',
      created_at: '2026-01-02T00:00:00.000Z',
      last_viewed: '2026-03-01T00:00:00.000Z',
    })
    insertEntry(h.dbPath, {
      video_id: 's3',
      title: 'Third',
      created_at: '2026-01-03T00:00:00.000Z',
      last_viewed: null,
    })

    const createdAsc = await (
      await request(h.app, 'http://localhost/api/entries?sort=created_asc&limit=50')
    ).json()
    expect(createdAsc.items.map((e: { video_id: string }) => e.video_id)).toEqual([
      's1',
      's2',
      's3',
    ])

    const viewedDesc = await (
      await request(h.app, 'http://localhost/api/entries?sort=viewed_desc&limit=50')
    ).json()
    // viewed first (stable by id desc within same timestamp), never-viewed last
    expect(viewedDesc.items.map((e: { video_id: string }) => e.video_id)).toEqual([
      's2',
      's1',
      's3',
    ])
  })

  it('orders pins at top when requested and persists the preference locally', () => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
      },
      configurable: true,
    })

    expect(readEntryPinsAtTop()).toBe(true)
    localStorage.setItem(ENTRY_PINS_KEY, 'false')
    expect(readEntryPinsAtTop()).toBe(false)

    expect(readNotebookPinsAtTop()).toBe(true)
    localStorage.setItem(NOTEBOOK_PINS_KEY, 'false')
    expect(readNotebookPinsAtTop()).toBe(false)

    expect(readBookmarkPinsAtTop()).toBe(true)
    localStorage.setItem(BOOKMARK_PINS_AT_TOP_KEY, 'false')
    expect(readBookmarkPinsAtTop()).toBe(false)
  })

  it('puts pinned rows first when pinsAtTop is true', async () => {
    insertEntry(h.dbPath, {
      video_id: 'p1',
      title: 'Unpinned newer',
      pinned: 0,
      created_at: '2026-01-03T00:00:00.000Z',
    })
    insertEntry(h.dbPath, {
      video_id: 'p2',
      title: 'Pinned older',
      pinned: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    })

    const withPins = await (
      await request(h.app, 'http://localhost/api/entries?pinsAtTop=true&limit=50')
    ).json()
    expect(withPins.items[0].video_id).toBe('p2')

    const withoutPins = await (
      await request(h.app, 'http://localhost/api/entries?pinsAtTop=false&limit=50')
    ).json()
    expect(withoutPins.items[0].video_id).toBe('p1')
  })

  it('marks an entry viewed and soft-deletes without returning it', async () => {
    const id = insertEntry(h.dbPath, { video_id: 'gone', title: 'Gone' })

    const viewed = await request(h.app, `http://localhost/api/entries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_viewed: true }),
    })
    const row = await viewed.json()
    expect(row.last_viewed).toBeTruthy()

    const never = await (
      await request(h.app, 'http://localhost/api/entries?view=never_viewed')
    ).json()
    expect(never.total).toBe(0)

    const del = await request(h.app, `http://localhost/api/entries/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)

    const list = await (await request(h.app, 'http://localhost/api/entries')).json()
    expect(list.total).toBe(0)
  })

  it('bulk pin, tag, and delete on summaries and bookmarks only touch selected rows', async () => {
    const eKeep = insertEntry(h.dbPath, { video_id: 'ek', title: 'E keep' })
    const eChange = insertEntry(h.dbPath, { video_id: 'ec', title: 'E change' })
    const eRemove = insertEntry(h.dbPath, { video_id: 'er', title: 'E remove' })
    const bKeep = insertBookmark(h.dbPath, { url: 'https://example.com/keep', title: 'B keep' })
    const bChange = insertBookmark(h.dbPath, {
      url: 'https://example.com/change',
      title: 'B change',
    })
    const bRemove = insertBookmark(h.dbPath, {
      url: 'https://example.com/remove',
      title: 'B remove',
    })

    await request(h.app, `http://localhost/api/entries/${eChange}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true, tags: ['bulk'] }),
    })
    await request(h.app, `http://localhost/api/entries/${eRemove}`, { method: 'DELETE' })
    await request(h.app, `http://localhost/api/bookmarks/${bChange}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true, tags: ['bulk'] }),
    })
    await request(h.app, `http://localhost/api/bookmarks/${bRemove}`, { method: 'DELETE' })

    const entries = await (await request(h.app, 'http://localhost/api/entries?limit=50')).json()
    const bookmarks = await (
      await request(h.app, 'http://localhost/api/bookmarks?limit=50')
    ).json()

    expect(entries.total).toBe(2)
    expect(bookmarks.total).toBe(2)
    expect(entries.items.find((e: { id: number }) => e.id === eKeep).pinned).toBe(0)
    expect(entries.items.find((e: { id: number }) => e.id === eChange)).toMatchObject({
      pinned: 1,
      tags: ['bulk'],
    })
    expect(bookmarks.items.find((b: { id: number }) => b.id === bKeep).pinned).toBe(0)
    expect(bookmarks.items.find((b: { id: number }) => b.id === bChange)).toMatchObject({
      pinned: 1,
      tags: ['bulk'],
    })
  })

  it('applies the shared list contract on bookmarks, notebooks, and linkedin', async () => {
    insertBookmark(h.dbPath, {
      title: 'Soil article',
      url: 'https://example.com/soil',
      folder_path: 'Reading',
      tags: '["plant"]',
      pinned: 1,
    })
    insertBookmark(h.dbPath, {
      title: 'Other',
      url: 'https://example.com/other',
      tags: '[]',
    })
    insertNotebook(h.dbPath, { title: 'Soil notebook', tags: '["plant"]', pinned: 1 })
    insertNotebook(h.dbPath, { title: 'Water', tags: '[]' })
    insertLinkedIn(h.dbPath, {
      title: 'Soil post',
      author_name: 'Gardener',
      content_text: 'mulch tips',
      tags: '["plant"]',
    })
    insertLinkedIn(h.dbPath, { title: 'Unrelated', content_text: 'hello' })

    expect(
      (
        await (
          await request(h.app, 'http://localhost/api/bookmarks?search=soil&searchScope=title')
        ).json()
      ).total,
    ).toBe(1)
    expect(
      (await (await request(h.app, 'http://localhost/api/bookmarks?tag=plant')).json()).total,
    ).toBe(1)
    expect(
      (
        await (
          await request(h.app, 'http://localhost/api/notebooks?search=soil&pinsAtTop=true')
        ).json()
      ).items[0].title,
    ).toBe('Soil notebook')
    expect(
      (
        await (
          await request(h.app, 'http://localhost/api/linkedin-saved?search=mulch')
        ).json()
      ).total,
    ).toBe(1)
  })
})
