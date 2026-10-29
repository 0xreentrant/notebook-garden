import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, notebookUrl, request, type Harness } from './helpers/harness'
import {
  MAX_SAVED_PAGES,
  listingAfter,
  mapSavedChild,
  mapSavedListing,
  walkSavedPages,
} from '../src/server/reddit-client'
import { upsertRedditSavedItems } from '../src/server/reddit-saved-api'

describe('reddit saved mapping', () => {
  it('maps a link, a self post, and a comment', () => {
    const created = new Date(1_700_000_000 * 1000).toISOString()
    const link = mapSavedChild({
      kind: 't3',
      data: {
        name: 't3_abc',
        title: 'Outbound',
        url: 'https://example.com/post',
        permalink: '/r/news/comments/abc/outbound/',
        subreddit: 'news',
        author: 'ada',
        is_self: false,
        selftext: '',
        over_18: false,
        created_utc: 1_700_000_000,
      },
    })
    expect(link).toMatchObject({
      reddit_name: 't3_abc',
      kind: 'link',
      title: 'Outbound',
      url: 'https://example.com/post',
      permalink: 'https://www.reddit.com/r/news/comments/abc/outbound/',
      subreddit: 'news',
      author: 'ada',
      content_text: '',
      over_18: 0,
      created_at: created,
    })

    const selfPost = mapSavedChild({
      kind: 't3',
      data: {
        name: 't3_self',
        title: 'Diary',
        url: 'https://www.reddit.com/r/test/comments/self/diary/',
        permalink: '/r/test/comments/self/diary/',
        subreddit: 'test',
        author: '[deleted]',
        is_self: true,
        selftext: 'hello body',
        over_18: true,
        created_utc: 1_700_000_000,
      },
    })
    expect(selfPost).toMatchObject({
      kind: 'link',
      url: 'https://www.reddit.com/r/test/comments/self/diary/',
      content_text: 'hello body',
      author: '[deleted]',
      over_18: 1,
    })

    const comment = mapSavedChild({
      kind: 't1',
      data: {
        name: 't1_cmt',
        link_title: 'Parent',
        body: 'a reply',
        permalink: '/r/test/comments/self/diary/cmt/',
        subreddit: 'test',
        link_url: 'https://example.com/parent',
        created_utc: 1_700_000_000,
      },
    })
    expect(comment).toMatchObject({
      reddit_name: 't1_cmt',
      kind: 'comment',
      title: 'Parent',
      url: 'https://www.reddit.com/r/test/comments/self/diary/cmt/',
      content_text: 'a reply',
      author: '[deleted]',
    })
  })

  it('drops unknown kinds and reads the next page cursor', () => {
    const listing = {
      data: {
        after: 't3_next',
        children: [
          { kind: 't5', data: { name: 't5_sub', title: 'nope' } },
          {
            kind: 't3',
            data: {
              name: 't3_ok',
              title: 'Keep',
              is_self: true,
              permalink: '/r/x/comments/ok/keep/',
              selftext: 'text',
              created_utc: 10,
            },
          },
        ],
      },
    }
    expect(mapSavedListing(listing).map((item) => item.reddit_name)).toEqual(['t3_ok'])
    expect(listingAfter(listing)).toBe('t3_next')
    expect(listingAfter({ data: { after: null } })).toBeNull()
    expect(() => mapSavedListing({})).toThrow(/children/)
  })

  it('ends on a null after and flags the page cap', async () => {
    const done = await walkSavedPages(async () => ({ data: { children: [], after: null } }))
    expect(done.pages).toBe(1)
    expect(done.truncated).toBe(false)

    let calls = 0
    const capped = await walkSavedPages(async () => {
      calls += 1
      return { data: { children: [], after: `t3_${calls}` } }
    })
    expect(calls).toBe(MAX_SAVED_PAGES)
    expect(capped.pages).toBe(MAX_SAVED_PAGES)
    expect(capped.truncated).toBe(true)
  })
})

describe('reddit saved store', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('upserts live rows, keeps a local delete, and lists the rest', async () => {
    const created = '2024-01-02T00:00:00.000Z'
    upsertRedditSavedItems([
      {
        reddit_name: 't3_keep',
        kind: 'link',
        title: 'Keep',
        url: 'https://example.com/keep',
        permalink: 'https://www.reddit.com/r/x/comments/keep/',
        subreddit: 'x',
        author: 'ada',
        content_text: 'first',
        over_18: 0,
        created_at: created,
      },
      {
        reddit_name: 't3_gone',
        kind: 'link',
        title: 'Gone',
        url: 'https://example.com/gone',
        permalink: 'https://www.reddit.com/r/x/comments/gone/',
        subreddit: 'x',
        author: 'ada',
        content_text: 'bye',
        over_18: 0,
        created_at: created,
      },
    ])

    const page = await (await request(h.app, 'http://localhost/api/reddit-saved')).json()
    const keep = page.items.find((item: { reddit_name: string }) => item.reddit_name === 't3_keep')
    const gone = page.items.find((item: { reddit_name: string }) => item.reddit_name === 't3_gone')
    expect(page.total).toBe(2)

    const removed = await request(h.app, `http://localhost/api/reddit-saved/${gone.id}`, {
      method: 'DELETE',
    })
    expect(removed.status).toBe(204)

    const patched = await request(h.app, `http://localhost/api/reddit-saved/${keep.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooklm_link: { url: notebookUrl('red'), title: 'Keep notebook' },
      }),
    })
    expect(patched.status).toBe(200)

    upsertRedditSavedItems([
      {
        reddit_name: 't3_keep',
        kind: 'link',
        title: 'Keep updated',
        url: 'https://example.com/keep',
        permalink: 'https://www.reddit.com/r/x/comments/keep/',
        subreddit: 'x',
        author: 'ada',
        content_text: 'second',
        over_18: 0,
        created_at: created,
      },
      {
        reddit_name: 't3_gone',
        kind: 'link',
        title: 'Gone updated',
        url: 'https://example.com/gone',
        permalink: 'https://www.reddit.com/r/x/comments/gone/',
        subreddit: 'x',
        author: 'ada',
        content_text: 'still gone',
        over_18: 0,
        created_at: created,
      },
    ])

    const next = await (await request(h.app, 'http://localhost/api/reddit-saved')).json()
    expect(next.total).toBe(1)
    expect(next.items[0].title).toBe('Keep updated')
    expect(next.items[0].content_text).toBe('second')
    expect(next.items[0].notebooklm_links[0].title).toBe('Keep notebook')

    const db = h.db()
    const deleted = db.prepare(
      `SELECT title, deleted_at FROM reddit_saved_items WHERE reddit_name = ?`,
    ).get('t3_gone') as { title: string; deleted_at: string | null }
    db.close()
    expect(deleted.title).toBe('Gone')
    expect(deleted.deleted_at).toBeTruthy()
  })
})
