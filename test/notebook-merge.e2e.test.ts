import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, insertNotebook, request, type Harness } from './helpers/harness'

type Source = { title: string; url: string | null }
type StoredNotebook = { title: string; sources: Source[] }

const mocks = vi.hoisted(() => ({
  withNotebooklmCookie: vi.fn(async <T>(fn: (cookie: string) => Promise<T>) => fn('test-cookie')),
  fetchNotebookDetailViaApi: vi.fn(),
  addYouTubeSourcesViaApi: vi.fn(),
  createNotebookViaApi: vi.fn(),
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
    fetchNotebookDetailViaApi: mocks.fetchNotebookDetailViaApi,
    addYouTubeSourcesViaApi: mocks.addYouTubeSourcesViaApi,
    createNotebookViaApi: mocks.createNotebookViaApi,
  }
})

function sourceRow(title: string, url: string | null) {
  const metadata = url
    ? [null, null, null, null, 5, null, null, [url]]
    : [null, null, null, null, 4]
  return [['src'], title, metadata, [null, 2]]
}

function notebookDetail(notebook: StoredNotebook, id: string) {
  return [[notebook.title, notebook.sources.map((source) => sourceRow(source.title, source.url)), id]]
}

function sources(prefix: string, count: number): Source[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `${prefix} ${index}`,
    url: `https://example.com/${prefix}/${index}`,
  }))
}

describe('merge notebooks e2e', () => {
  let h: Harness
  let notebooks: Map<string, StoredNotebook>
  let pauseMs: number

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withNotebooklmCookie.mockImplementation(async (fn) => fn('test-cookie'))
    notebooks = new Map()
    pauseMs = 0
    mocks.fetchNotebookDetailViaApi.mockImplementation(async (_cookie: string, id: string) => {
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
      const notebook = notebooks.get(id)
      if (!notebook) throw new Error(`missing ${id}`)
      return notebookDetail(notebook, id)
    })
    mocks.addYouTubeSourcesViaApi.mockImplementation(async (_cookie: string, id: string, urls: string[]) => {
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
      const notebook = notebooks.get(id)
      if (!notebook) throw new Error(`missing ${id}`)
      for (const url of urls) notebook.sources.push({ title: url, url })
    })
    mocks.createNotebookViaApi.mockImplementation(async (_cookie: string, title: string) => {
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
      const id = crypto.randomUUID()
      notebooks.set(id, { title, sources: [] })
      return id
    })
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  function seed(id: string, title: string, rows: Source[]) {
    notebooks.set(id, { title, sources: rows })
    insertNotebook(h.dbPath, {
      notebooklm_id: id,
      title,
      source_count: rows.length,
    })
  }

  async function library() {
    return (await request(h.app, 'http://localhost/api/notebooks?limit=50')).json() as {
      items: { notebooklm_id: string; title: string; source_count: number }[]
    }
  }

  it('merges unique sources into the destination and leaves the other notebook', async () => {
    const dest = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    seed(dest, 'Garden', [
      { title: 'Kept', url: 'https://example.com/kept' },
      { title: 'Notes', url: null },
    ])
    seed(other, 'Clippings', [
      { title: 'Kept again', url: 'https://example.com/kept/' },
      { title: 'Essay', url: 'https://example.com/essay' },
    ])

    const started = performance.now()
    const merged = await request(h.app, 'http://localhost/api/notebooks/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNotebooklmIds: [dest, other],
        destinationNotebooklmId: dest,
      }),
    })
    const visibleMs = performance.now() - started
    expect(merged.status).toBe(200)
    const report = await merged.json()
    expect(report).toMatchObject({
      destinationNotebooklmId: dest,
      destinationTitle: 'Garden',
      addedCount: 1,
      sourceCount: 3,
    })
    expect(report.skipped).toEqual([
      { title: 'Kept again', reason: 'duplicate' },
    ])
    expect(mocks.addYouTubeSourcesViaApi).toHaveBeenCalledWith(
      'test-cookie',
      dest,
      ['https://example.com/essay'],
    )

    const rows = await library()
    const reconcileMs = performance.now() - started
    const garden = rows.items.find((row) => row.notebooklm_id === dest)
    const clippings = rows.items.find((row) => row.notebooklm_id === other)
    expect(garden?.source_count).toBe(3)
    expect(clippings?.title).toBe('Clippings')
    console.log(`golden visible_ms=${visibleMs.toFixed(1)} reconcile_ms=${reconcileMs.toFixed(1)}`)
  })

  it('previews the over-cap list and merges only the checked sources', async () => {
    const dest = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    seed(dest, 'Full', sources('dest', 48))
    seed(other, 'Extra', sources('extra', 5))
    const checked = sources('extra', 5).slice(0, 2).map((source) => source.url as string)

    const preview = await request(h.app, 'http://localhost/api/notebooks/merge/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNotebooklmIds: [dest, other],
        destinationNotebooklmId: dest,
      }),
    })
    expect(preview.status).toBe(200)
    const choices = await preview.json()
    expect(choices.destinationSourceCount).toBe(48)
    expect(choices.cap).toBe(50)
    expect(choices.choices.filter((choice: { role: string }) => choice.role === 'add')).toHaveLength(5)
    expect(choices.choices.filter((choice: { role: string }) => choice.role === 'destination')).toHaveLength(48)

    const refused = await request(h.app, 'http://localhost/api/notebooks/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNotebooklmIds: [dest, other],
        destinationNotebooklmId: dest,
      }),
    })
    expect(refused.status).toBe(400)
    expect(mocks.addYouTubeSourcesViaApi).not.toHaveBeenCalled()

    const started = performance.now()
    const merged = await request(h.app, 'http://localhost/api/notebooks/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNotebooklmIds: [dest, other],
        destinationNotebooklmId: dest,
        urls: checked,
      }),
    })
    const visibleMs = performance.now() - started
    expect(merged.status).toBe(200)
    expect(await merged.json()).toMatchObject({ addedCount: 2, sourceCount: 50 })

    const rows = await library()
    const reconcileMs = performance.now() - started
    expect(rows.items.find((row) => row.notebooklm_id === dest)?.source_count).toBe(50)
    expect(notebooks.get(dest)?.sources).toHaveLength(50)
    expect(rows.items.find((row) => row.notebooklm_id === other)?.source_count).toBe(5)
    console.log(`checklist visible_ms=${visibleMs.toFixed(1)} reconcile_ms=${reconcileMs.toFixed(1)}`)
  })

  it('keeps a finished merge when a new notebook id arrives late', async () => {
    const dest = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const other = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    seed(dest, 'Garden', [{ title: 'Kept', url: 'https://example.com/kept' }])
    seed(other, 'Clippings', [{ title: 'Essay', url: 'https://example.com/essay' }])

    const settled = await request(h.app, 'http://localhost/api/notebooks/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNotebooklmIds: [dest, other],
        destinationNotebooklmId: dest,
      }),
    })
    expect(settled.status).toBe(200)
    expect((await library()).items.find((row) => row.notebooklm_id === dest)?.source_count).toBe(2)

    pauseMs = 250
    const started = performance.now()
    const pending = request(h.app, 'http://localhost/api/notebooks/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNotebooklmIds: [dest, other],
        title: 'Late garden',
      }),
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    const during = await library()
    expect(during.items.some((row) => row.title === 'Late garden')).toBe(false)
    expect(during.items.find((row) => row.notebooklm_id === dest)?.source_count).toBe(2)

    const merged = await pending
    const visibleMs = performance.now() - started
    expect(merged.status).toBe(200)
    const report = await merged.json()
    expect(report.destinationTitle).toBe('Late garden')
    expect(report.addedCount).toBe(2)
    expect(notebooks.has(report.destinationNotebooklmId)).toBe(true)

    const rows = await library()
    const reconcileMs = performance.now() - started
    const created = rows.items.find((row) => row.notebooklm_id === report.destinationNotebooklmId)
    expect(created?.source_count).toBe(2)
    expect(rows.items.find((row) => row.notebooklm_id === dest)?.source_count).toBe(2)
    console.log(`tail visible_ms=${visibleMs.toFixed(1)} reconcile_ms=${reconcileMs.toFixed(1)} delay_ms=${pauseMs}`)
  })
})
