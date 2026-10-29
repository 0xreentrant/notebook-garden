import { chmodSync, mkdirSync } from 'node:fs'
import type { Page } from 'playwright'
import {
  RedditSessionError,
  SAVED_JSON_ROOTS,
  isSavedListing,
  redditProfileDir,
  savedListingUrl,
  sessionBlockedReason,
} from '../src/server/reddit-client'

// ponytail: one Reddit navigation every 8s. A tighter loop is what earned the 429.
const MIN_REQUEST_GAP_MS = 8_000
let lastRequestAt = 0

function waitForRequestGap() {
  const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt)
  lastRequestAt = Date.now() + Math.max(0, wait)
  if (wait > 0) return new Promise((resolve) => setTimeout(resolve, wait))
  return Promise.resolve()
}

export async function launchRedditProfile(headless: boolean) {
  const profileDir = redditProfileDir()
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  chmodSync(profileDir, 0o700)
  const { chromium } = await import('playwright')
  const options = {
    headless,
    viewport: headless ? null : { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--hide-crash-restore-bubble'],
    chromiumSandbox: true,
  }
  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: 'chrome',
    })
  } catch {
    return chromium.launchPersistentContext(profileDir, { ...options, channel: 'chrome' }).catch(() => {
      return chromium.launchPersistentContext(profileDir, options)
    })
  }
}

export async function readPageBody(page: Page, url: string) {
  await waitForRequestGap()
  let status = 0
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    status = response?.status() ?? 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_ABORTED|Timeout/.test(message)) throw error
  }
  const text = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '')
  const trimmed = text.trim()
  let body: unknown = null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      body = JSON.parse(trimmed) as unknown
    } catch {
      body = null
    }
  }
  return {
    status,
    body,
    text,
    url: page.url(),
  }
}

export async function chooseSavedHost(page: Page) {
  const failures: string[] = []
  for (const root of SAVED_JSON_ROOTS) {
    const response = await readPageBody(page, savedListingUrl(root, null))
    const blocked = sessionBlockedReason(response)
    if (blocked === 'HTTP 429') throw new RedditSessionError('HTTP 429')
    if (!blocked && response.status === 200 && isSavedListing(response.body)) {
      return { root, first: response }
    }
    failures.push(`${new URL(root).host}: ${blocked ?? `HTTP ${response.status}`}`)
  }
  throw new RedditSessionError(failures.join('; '))
}
