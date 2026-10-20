import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const envFile = path.resolve(process.cwd(), '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8765/callback'
export const REDDIT_SCOPES = 'identity history'
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const AUTHORIZE_URL = 'https://www.reddit.com/api/v1/authorize'
const PAGE_LIMIT = 100
// ponytail: one sync stops after 50 pages (5000 saves). Upgrade path: persist `after` and resume.
const MAX_PAGES = 50

export class RedditAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedditAuthError'
  }
}

export type RedditTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
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

export type StoredRedditToken = {
  refresh_token: string
  access_token: string
  expires_at: string
  scope: string
  username: string
  client_id: string
}

export function redditTokenPath() {
  return process.env.REDDIT_TOKEN_PATH
    ?? path.join(os.homedir(), '.config/youtube-ask-summarize/reddit-oauth.json')
}

export function redditUserAgent(username?: string) {
  const override = process.env.REDDIT_USER_AGENT?.trim()
  if (override) return override
  const contact = username ? `by /u/${username}` : 'personal saved sync'
  return `${process.platform}:notebook-garden:0.1.0 (${contact})`
}

export function redditClientId() {
  const id = process.env.REDDIT_CLIENT_ID?.trim()
  if (!id) {
    throw new RedditAuthError('Set REDDIT_CLIENT_ID from a Reddit installed or web app')
  }
  return id
}

function redditClientSecret() {
  return process.env.REDDIT_CLIENT_SECRET ?? ''
}

export function parseTokenResponse(body: unknown): RedditTokenResponse {
  if (!body || typeof body !== 'object') {
    throw new RedditAuthError('Reddit token response was not JSON')
  }
  const row = body as Record<string, unknown>
  if (typeof row.error === 'string' && row.error) {
    const description = typeof row.error_description === 'string' ? `: ${row.error_description}` : ''
    throw new RedditAuthError(`Reddit token error: ${row.error}${description}`)
  }
  if (typeof row.access_token !== 'string' || !row.access_token) {
    throw new RedditAuthError('Reddit token response missing access_token')
  }
  const expiresIn = typeof row.expires_in === 'number' && row.expires_in > 0
    ? row.expires_in
    : 3600
  return {
    access_token: row.access_token,
    expires_in: expiresIn,
    refresh_token: typeof row.refresh_token === 'string' ? row.refresh_token : undefined,
    scope: typeof row.scope === 'string' ? row.scope : undefined,
  }
}

export function buildAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    state: input.state,
    redirect_uri: input.redirectUri,
    duration: 'permanent',
    scope: REDDIT_SCOPES,
  })
  return `${AUTHORIZE_URL}?${params}`
}

export function saveRedditToken(token: StoredRedditToken) {
  const file = redditTokenPath()
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}

export function readRedditToken(): StoredRedditToken {
  let raw: string
  try {
    raw = readFileSync(redditTokenPath(), 'utf8')
  } catch {
    throw new RedditAuthError(
      `No Reddit token. Run npm run reddit:login (expected ${redditTokenPath()})`,
    )
  }
  let parsed: Partial<StoredRedditToken>
  try {
    parsed = JSON.parse(raw) as Partial<StoredRedditToken>
  } catch {
    throw new RedditAuthError('Reddit token file is not JSON')
  }
  if (!parsed.refresh_token || !parsed.username || !parsed.access_token || !parsed.expires_at) {
    throw new RedditAuthError('Reddit token file is missing refresh_token, access_token, or username')
  }
  return {
    refresh_token: parsed.refresh_token,
    access_token: parsed.access_token,
    expires_at: parsed.expires_at,
    scope: parsed.scope ?? REDDIT_SCOPES,
    username: parsed.username,
    client_id: parsed.client_id ?? '',
  }
}

async function requestToken(params: Record<string, string>, clientId: string) {
  const basic = Buffer.from(`${clientId}:${redditClientSecret()}`).toString('base64')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(),
    },
    body: new URLSearchParams(params),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok && !(body && typeof body === 'object' && 'error' in body)) {
    throw new RedditAuthError(`Reddit token request failed (${response.status})`)
  }
  return parseTokenResponse(body)
}

export function exchangeAuthorizationCode(input: {
  clientId: string
  redirectUri: string
  code: string
}) {
  return requestToken({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  }, input.clientId)
}

export async function fetchIdentity(accessToken: string) {
  const response = await fetch('https://oauth.reddit.com/api/v1/me', {
    headers: {
      Authorization: `bearer ${accessToken}`,
      'User-Agent': redditUserAgent(),
    },
  })
  const body = await response.json().catch(() => null) as { name?: unknown } | null
  if (!response.ok || typeof body?.name !== 'string' || !body.name) {
    throw new RedditAuthError(`Reddit identity failed (${response.status})`)
  }
  return body.name
}

async function refreshAccessToken(stored: StoredRedditToken) {
  const clientId = redditClientId()
  if (stored.client_id && stored.client_id !== clientId) {
    throw new RedditAuthError(
      'Stored Reddit token was issued for a different REDDIT_CLIENT_ID. Run npm run reddit:login again.',
    )
  }
  const token = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
  }, clientId)
  const next: StoredRedditToken = {
    ...stored,
    access_token: token.access_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refresh_token: token.refresh_token ?? stored.refresh_token,
    scope: token.scope ?? stored.scope,
    client_id: clientId,
  }
  saveRedditToken(next)
  return next
}

export async function validAccessToken() {
  const stored = readRedditToken()
  const expires = Date.parse(stored.expires_at)
  if (stored.access_token && Number.isFinite(expires) && expires - Date.now() > 60_000) {
    return { token: stored.access_token, username: stored.username }
  }
  const next = await refreshAccessToken(stored)
  return { token: next.access_token, username: next.username }
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

export async function fetchSavedPages(accessToken: string, username: string) {
  const items: MappedRedditSaved[] = []
  let after: string | null = null
  let pages = 0
  let lastAfter: string | null = null
  while (pages < MAX_PAGES) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      raw_json: '1',
    })
    if (after) params.set('after', after)
    const response = await fetch(
      `https://oauth.reddit.com/user/${encodeURIComponent(username)}/saved?${params}`,
      {
        headers: {
          Authorization: `bearer ${accessToken}`,
          'User-Agent': redditUserAgent(username),
        },
      },
    )
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${response.status}`
      if (response.status === 401 || response.status === 403) {
        throw new RedditAuthError(`Reddit saved listing failed (${response.status}): ${message}`)
      }
      throw new Error(`Reddit saved listing failed (${response.status}): ${message}`)
    }
    items.push(...mapSavedListing(body))
    pages += 1
    lastAfter = listingAfter(body)
    if (!lastAfter) break
    after = lastAfter
  }
  return {
    items,
    pages,
    truncated: pages >= MAX_PAGES && lastAfter != null,
  }
}
