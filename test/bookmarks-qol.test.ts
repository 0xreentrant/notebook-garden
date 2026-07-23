import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromeTimeToIso } from '../src/server/chrome-bookmarks'
import { countPendingBookmarkSummaries, syncBookmarksFromChrome } from '../src/server/bookmarks-api'
import {
  createHarness,
  insertBookmark,
  request,
  type Harness,
} from './helpers/harness'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(() => ({ unref: vi.fn() })),
  }
})

function webkitMicros(iso: string) {
  const ms = Date.parse(iso)
  return String((ms + 11_644_473_600_000) * 1000)
}

function writeChromeProfile(userDataDir: string, bookmarks: {
  url: string
  name: string
  date_added: string
}[]) {
  const profileDir = path.join(userDataDir, 'Default')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    path.join(profileDir, 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks Bar',
          children: bookmarks.map((b) => ({
            type: 'url',
            name: b.name,
            url: b.url,
            date_added: b.date_added,
          })),
        },
      },
    }),
  )
}

describe('4. Bookmarks-specific QoL', () => {
  let h: Harness
  let chromeDir: string

  beforeEach(() => {
    h = createHarness()
    chromeDir = mkdtempSync(path.join(tmpdir(), 'chrome-bookmarks-'))
  })

  afterEach(() => {
    h.cleanup()
    rmSync(chromeDir, { recursive: true, force: true })
  })

  it('syncs new Chrome bookmarks without wiping local metadata on re-sync', async () => {
    const oldIso = '2020-06-01T12:00:00.000Z'
    insertBookmark(h.dbPath, {
      url: 'https://example.com/existing',
      title: 'Existing',
      pinned: 1,
      tags: '["keep"]',
      notebooklm_links: JSON.stringify([
        { url: 'https://notebooklm.google.com/notebook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'N' },
      ]),
      notebooklm_url: 'https://notebooklm.google.com/notebook/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      summary_text: 'Kept summary',
      summary_status: 'complete',
      created_at: '2024-01-01T00:00:00.000Z',
    })

    writeChromeProfile(chromeDir, [
      {
        url: 'https://example.com/existing',
        name: 'Existing renamed in Chrome',
        date_added: webkitMicros(oldIso),
      },
      {
        url: 'https://example.com/new',
        name: 'New bookmark',
        date_added: webkitMicros('2021-01-01T00:00:00.000Z'),
      },
    ])

    const first = syncBookmarksFromChrome(chromeDir)
    expect(first.inserted).toBe(1)
    expect(first.skipped).toBe(1)

    const list = await (await request(h.app, 'http://localhost/api/bookmarks?limit=50')).json()
    expect(list.total).toBe(2)
    const existing = list.items.find((b: { url: string }) => b.url === 'https://example.com/existing')
    expect(existing).toMatchObject({
      pinned: 1,
      tags: ['keep'],
      summary_text: 'Kept summary',
      summary_status: 'complete',
    })
    expect(existing.notebooklm_links).toHaveLength(1)

    const second = syncBookmarksFromChrome(chromeDir)
    expect(second.inserted).toBe(0)
    const again = await (await request(h.app, 'http://localhost/api/bookmarks?limit=50')).json()
    const still = again.items.find((b: { url: string }) => b.url === 'https://example.com/existing')
    expect(still).toMatchObject({
      pinned: 1,
      tags: ['keep'],
      summary_text: 'Kept summary',
    })
  })

  it('backdates created_at from Chrome when Chrome date is older', () => {
    const chromeIso = '2019-05-01T00:00:00.000Z'
    insertBookmark(h.dbPath, {
      url: 'https://example.com/backdate',
      title: 'Backdate me',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    writeChromeProfile(chromeDir, [
      {
        url: 'https://example.com/backdate',
        name: 'Backdate me',
        date_added: webkitMicros(chromeIso),
      },
    ])

    expect(chromeTimeToIso(webkitMicros(chromeIso))).toBe(chromeIso)
    syncBookmarksFromChrome(chromeDir)

    const db = h.db()
    const row = db
      .prepare(`SELECT created_at FROM bookmarks WHERE url = ?`)
      .get('https://example.com/backdate') as { created_at: string }
    db.close()
    expect(row.created_at).toBe(chromeIso)
  })

  it('reports pending summary status after syncing new bookmarks', async () => {
    writeChromeProfile(chromeDir, [
      {
        url: 'https://example.com/pending-a',
        name: 'Pending A',
        date_added: webkitMicros('2022-01-01T00:00:00.000Z'),
      },
      {
        url: 'https://example.com/pending-b',
        name: 'Pending B',
        date_added: webkitMicros('2022-02-01T00:00:00.000Z'),
      },
    ])

    syncBookmarksFromChrome(chromeDir)
    expect(countPendingBookmarkSummaries()).toBe(2)

    const status = await request(h.app, 'http://localhost/api/bookmarks/summary-status')
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ pending: 2 })

    const list = await (await request(h.app, 'http://localhost/api/bookmarks?limit=50')).json()
    expect(list.items.every((b: { summary_status: string }) => b.summary_status === 'pending')).toBe(
      true,
    )
  })
})
