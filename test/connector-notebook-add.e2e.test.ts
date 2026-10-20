import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, insertBookmark, insertEntry, insertLinkedIn, notebookUrl, openDb, request, type Harness } from './helpers/harness'
import { resetTabSelections, selectedConnectorResources, toggleSelectedId } from '../src/hooks/useTabSelection'
import { linkConnectorResources, notebookLinkBaseline } from '../src/lib/connector-notebook-add'
import { bulkCreateNotebookForVideos } from '../src/notebooklm-importer'

const mocks = vi.hoisted(() => ({
  withNotebooklmCookie: vi.fn(async <T>(fn: (cookie: string) => Promise<T>) => fn('test-cookie')),
  bulkCreateAndImportViaApi: vi.fn(),
}))

vi.mock('../src/server/notebooklm/notebooklm-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/notebooklm/notebooklm-auth')>()
  return { ...actual, withNotebooklmCookie: mocks.withNotebooklmCookie }
})

vi.mock('../src/server/notebooklm/notebooklm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/notebooklm/notebooklm')>()
  return { ...actual, bulkCreateAndImportViaApi: mocks.bulkCreateAndImportViaApi }
})

function insertReddit(dbPath: string, title: string, url: string) {
  const sqlite = openDb(dbPath)
  const now = '2026-01-01T00:00:00.000Z'
  const result = sqlite.prepare(`
    INSERT INTO reddit_saved_items (
      reddit_name, kind, title, url, permalink, subreddit, author, content_text,
      over_18, notebooklm_links, pinned, tags, created_at, updated_at
    ) VALUES (?, 'link', ?, ?, ?, 'test', 'anon', '', 0, '[]', 0, '[]', ?, ?)
  `).run(`t3_${Math.random().toString(36).slice(2)}`, title, url, url, now, now)
  sqlite.close()
  return Number(result.lastInsertRowid)
}

describe('cross-connector add to notebook', () => {
  let h: Harness

  beforeEach(() => {
    vi.clearAllMocks()
    resetTabSelections()
    mocks.withNotebooklmCookie.mockImplementation(async (fn) => fn('test-cookie'))
    h = createHarness()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return h.app.request(url, init)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetTabSelections()
    h.cleanup()
  })

  async function notebookLink(path: string) {
    const row = await (await request(h.app, path)).json() as { notebooklm_url: string | null }
    return row.notebooklm_url
  }

  it('adds every selected connector into one notebook', async () => {
    const youtubeId = insertEntry(h.dbPath, { title: 'Video', url: 'https://www.youtube.com/watch?v=cross1' })
    const bookmarkId = insertBookmark(h.dbPath, { title: 'Essay', url: 'https://example.com/essay' })
    const linkedinId = insertLinkedIn(h.dbPath, { title: 'Post', linkedin_url: 'https://www.linkedin.com/feed/update/cross' })
    const redditId = insertReddit(h.dbPath, 'Thread', 'https://example.com/thread')
    toggleSelectedId('youtube', youtubeId, true, { title: 'Video', url: 'https://www.youtube.com/watch?v=cross1' })
    toggleSelectedId('bookmarks', bookmarkId, true, { title: 'Essay', url: 'https://example.com/essay' })
    toggleSelectedId('linkedin', linkedinId, true, { title: 'Post', url: 'https://www.linkedin.com/feed/update/cross' })
    toggleSelectedId('reddit', redditId, true, { title: 'Thread', url: 'https://example.com/thread' })
    const resources = selectedConnectorResources()
    expect(resources.map((resource) => resource.connector)).toEqual([
      'youtube',
      'bookmarks',
      'linkedin',
      'reddit',
    ])

    const notebookId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    mocks.bulkCreateAndImportViaApi.mockResolvedValue({
      notebookId,
      notebookUrl: notebookUrl(notebookId),
    })

    const started = performance.now()
    const baseline = await notebookLinkBaseline(resources)
    const created = await bulkCreateNotebookForVideos('Imported sources (4)', resources.map((resource) => resource.url))
    expect(created.notebookUrl).toBe(notebookUrl(notebookId))
    await linkConnectorResources({
      resources,
      urls: resources.map((resource) => resource.url),
      notebookUrl: created.notebookUrl as string,
      title: 'Imported sources (4)',
      baseline,
    })
    const visibleMs = performance.now() - started

    expect(await notebookLink(`http://localhost/api/entries/${youtubeId}`)).toBe(notebookUrl(notebookId))
    expect(await notebookLink(`http://localhost/api/bookmarks/${bookmarkId}`)).toBe(notebookUrl(notebookId))
    expect(await notebookLink(`http://localhost/api/linkedin-saved/${linkedinId}`)).toBe(notebookUrl(notebookId))
    expect(await notebookLink(`http://localhost/api/reddit-saved/${redditId}`)).toBe(notebookUrl(notebookId))
    const reconcileMs = performance.now() - started
    console.log(`golden visible_ms=${visibleMs.toFixed(1)} reconcile_ms=${reconcileMs.toFixed(1)}`)
  })

  it('does not let a late notebook id replace a newer link', async () => {
    // ponytail: NotebookLM create is delayed 300ms. The vitest 5s timeout is the ceiling.
    const youtubeId = insertEntry(h.dbPath, { title: 'Video', url: 'https://www.youtube.com/watch?v=late1' })
    const bookmarkId = insertBookmark(h.dbPath, { title: 'Essay', url: 'https://example.com/late-essay' })
    const video = { title: 'Video', url: 'https://www.youtube.com/watch?v=late1' }
    const essay = { title: 'Essay', url: 'https://example.com/late-essay' }
    toggleSelectedId('youtube', youtubeId, true, video)
    toggleSelectedId('bookmarks', bookmarkId, true, essay)
    const both = selectedConnectorResources()
    const youtubeOnly = both.filter((resource) => resource.connector === 'youtube')
    const slowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const fastId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

    mocks.bulkCreateAndImportViaApi.mockImplementation(async (_cookie: string, title: string) => {
      if (title === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return { notebookId: slowId, notebookUrl: notebookUrl(slowId) }
      }
      return { notebookId: fastId, notebookUrl: notebookUrl(fastId) }
    })

    const slowBaseline = await notebookLinkBaseline(both)
    const started = performance.now()
    const slowPending = (async () => {
      const created = await bulkCreateNotebookForVideos('slow', both.map((resource) => resource.url))
      return linkConnectorResources({
        resources: both,
        urls: both.map((resource) => resource.url),
        notebookUrl: created.notebookUrl as string,
        title: 'slow',
        baseline: slowBaseline,
      })
    })()

    await new Promise((resolve) => setTimeout(resolve, 40))
    const fastBaseline = await notebookLinkBaseline(youtubeOnly)
    const fastCreated = await bulkCreateNotebookForVideos('fast', youtubeOnly.map((resource) => resource.url))
    await linkConnectorResources({
      resources: youtubeOnly,
      urls: youtubeOnly.map((resource) => resource.url),
      notebookUrl: fastCreated.notebookUrl as string,
      title: 'fast',
      baseline: fastBaseline,
    })
    const visibleMs = performance.now() - started
    expect(await notebookLink(`http://localhost/api/entries/${youtubeId}`)).toBe(notebookUrl(fastId))

    await slowPending
    expect(await notebookLink(`http://localhost/api/entries/${youtubeId}`)).toBe(notebookUrl(fastId))
    expect(await notebookLink(`http://localhost/api/bookmarks/${bookmarkId}`)).toBe(notebookUrl(slowId))
    const reconcileMs = performance.now() - started
    console.log(`tail visible_ms=${visibleMs.toFixed(1)} reconcile_ms=${reconcileMs.toFixed(1)} delay_ms=300`)
  })
})
