import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const envFile = path.resolve(process.cwd(), '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

export const SAVED_PAGE_URL = 'https://www.reddit.com/saved/'
export const SAVED_JSON_ROOTS = [
  'https://old.reddit.com/saved.json',
  'https://www.reddit.com/saved.json',
] as const
const PAGE_LIMIT = 100
// ponytail: one collect stops after 50 pages (5000 saves). Upgrade path: persist `after` and resume.
export const MAX_SAVED_PAGES = 50

export class RedditSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedditSessionError'
  }
}

export type MappedRedditSaved = {
  reddit_name: string
  kind: 'link' | 'comment'
  title: string
  url: string
  permalink: string
  subreddit: string
  author: string
  content_text: string
  over_18: number
  created_at: string
}

export function redditProfileDir() {
  return process.env.REDDIT_PROFILE_DIR
    ?? path.join(os.homedir(), '.config', 'reddit-saved', 'chrome-profile')
}

export function savedListingUrl(root: string, after: string | null) {
  const url = new URL(root)
  url.searchParams.set('limit', String(PAGE_LIMIT))
  url.searchParams.set('raw_json', '1')
  if (after) url.searchParams.set('after', after)
  return url.toString()
}

export function isSavedListing(body: unknown) {
  if (!body || typeof body !== 'object') return false
  const children = (body as { data?: { children?: unknown } }).data?.children
  return Array.isArray(children)
}

export function sessionBlockedReason(input: {
  status: number
  text: string
  url: string
  body?: unknown
}) {
  if (input.status === 401 || input.status === 403 || input.status === 429) return `HTTP ${input.status}`
  const url = input.url.toLowerCase()
  if (url.includes('/login') || url.includes('/register')) return 'login wall'
  if (isSavedListing(input.body)) return null
  const sample = input.text.slice(0, 4000).toLowerCase()
  if (sample.includes('http error 429') || sample.includes('too many requests')) return 'HTTP 429'
  if (
    sample.includes('captcha')
    || sample.includes('prove your humanity')
    || sample.includes('recaptcha')
  ) {
    return 'captcha'
  }
  return null
}

function stringField(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

function absolutePermalink(permalink: string) {
  if (!permalink) return ''
  if (permalink.startsWith('http://') || permalink.startsWith('https://')) return permalink
  return `https://www.reddit.com${permalink.startsWith('/') ? permalink : `/${permalink}`}`
}

function createdAtFromUtc(value: unknown) {
  const seconds = typeof value === 'number'
    ? value
    : typeof value === 'string' && value
      ? Number(value)
      : NaN
  if (!Number.isFinite(seconds)) return new Date(0).toISOString()
  return new Date(seconds * 1000).toISOString()
}

export function mapSavedChild(child: unknown): MappedRedditSaved | null {
  if (!child || typeof child !== 'object') return null
  const row = child as { kind?: unknown; data?: unknown }
  if (!row.data || typeof row.data !== 'object') return null
  const data = row.data as Record<string, unknown>
  const id = stringField(data, 'id')
  const name = stringField(data, 'name') || (typeof row.kind === 'string' && id ? `${row.kind}_${id}` : '')
  if (!name) return null
  const permalink = absolutePermalink(stringField(data, 'permalink'))
  const author = stringField(data, 'author') || '[deleted]'
  const subreddit = stringField(data, 'subreddit')
  const over18 = data.over_18 === true ? 1 : 0
  const createdAt = createdAtFromUtc(data.created_utc)
  if (row.kind === 't3') {
    const isSelf = data.is_self === true
    const linkUrl = stringField(data, 'url')
    const url = !isSelf && /^https?:\/\//.test(linkUrl) ? linkUrl : permalink || linkUrl
    if (!url) return null
    return {
      reddit_name: name,
      kind: 'link',
      title: stringField(data, 'title') || name,
      url,
      permalink: permalink || url,
      subreddit,
      author,
      content_text: stringField(data, 'selftext'),
      over_18: over18,
      created_at: createdAt,
    }
  }
  if (row.kind === 't1') {
    const url = permalink || stringField(data, 'link_url')
    if (!url) return null
    const body = stringField(data, 'body')
    return {
      reddit_name: name,
      kind: 'comment',
      title: stringField(data, 'link_title') || body.slice(0, 120) || name,
      url,
      permalink: permalink || url,
      subreddit,
      author,
      content_text: body,
      over_18: over18,
      created_at: createdAt,
    }
  }
  return null
}

export function listingAfter(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const after = (body as { data?: { after?: unknown } }).data?.after
  return typeof after === 'string' && after ? after : null
}

export function mapSavedListing(body: unknown): MappedRedditSaved[] {
  if (!body || typeof body !== 'object') {
    throw new Error('Reddit saved listing was not JSON')
  }
  const children = (body as { data?: { children?: unknown } }).data?.children
  if (!Array.isArray(children)) {
    throw new Error('Reddit saved listing missing children')
  }
  const mapped: MappedRedditSaved[] = []
  for (const child of children) {
    const item = mapSavedChild(child)
    if (item) mapped.push(item)
  }
  return mapped
}

export async function walkSavedPages(
  loadPage: (after: string | null) => Promise<unknown>,
  options?: {
    initialBody?: unknown
    stopAfterPage?: (pageItems: MappedRedditSaved[]) => boolean
  },
) {
  const items: MappedRedditSaved[] = []
  let after: string | null = null
  let pages = 0
  let lastAfter: string | null = null
  let stoppedEarly = false
  let useInitial = options != null && 'initialBody' in options
  while (pages < MAX_SAVED_PAGES) {
    const body = useInitial ? options?.initialBody : await loadPage(after)
    useInitial = false
    const pageItems = mapSavedListing(body)
    items.push(...pageItems)
    pages += 1
    lastAfter = listingAfter(body)
    if (options?.stopAfterPage?.(pageItems)) {
      stoppedEarly = true
      break
    }
    if (!lastAfter) break
    after = lastAfter
  }
  return {
    items,
    pages,
    truncated: !stoppedEarly && pages >= MAX_SAVED_PAGES && lastAfter != null,
  }
}
