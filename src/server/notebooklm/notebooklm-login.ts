import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext } from 'playwright'
import { NOTEBOOKLM_BASE_URL } from './notebooklm'

export const DEFAULT_PROFILE_DIR = process.env.YT_PROFILE_DIR
  ?? path.join(os.homedir(), '.config/youtube-ask-summarize/chrome-profile')

const LOGIN_URL = process.env.NOTEBOOKLM_LOGIN_URL ?? NOTEBOOKLM_BASE_URL
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const LOGIN_POLL_MS = 2000
const LOGIN_COOLDOWN_MS = 60_000

const SESSION_COOKIE_NAMES = ['SID', '__Secure-1PSID', '__Secure-3PSID']

let loginPromise: Promise<string | null> | null = null
let lastFailedLoginAt = 0

type PlaywrightCookie = {
  name: string
  value: string
  domain: string
}

function extractToken(key: string, html: string): string | null {
  const match = new RegExp(`"${key}":"([^"]+)"`).exec(html)
  return match?.[1] ?? null
}

export function formatCookieHeader(cookies: PlaywrightCookie[]): string {
  const relevant = cookies.filter((cookie) =>
    cookie.domain.includes('google.com') || cookie.domain.includes('notebooklm.google.com'),
  )
  return relevant.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

export function hasGoogleSessionCookies(cookies: PlaywrightCookie[]): boolean {
  const names = new Set(cookies.map((cookie) => cookie.name))
  return SESSION_COOKIE_NAMES.some((name) => names.has(name))
}

export function isNotebooklmAuthorized(html: string): boolean {
  return Boolean(extractToken('cfb2h', html) && extractToken('SNlM0e', html))
}

export async function isNotebooklmProfileReady(
  context: BrowserContext,
  html: string,
): Promise<boolean> {
  if (!isNotebooklmAuthorized(html)) return false
  return hasGoogleSessionCookies(await context.cookies())
}

export async function cookieHeaderFromContext(
  context: BrowserContext,
  html: string,
): Promise<string | null> {
  if (!await isNotebooklmProfileReady(context, html)) return null
  // ponytail: URL-scoped cookies only - the full jar has duplicate SID cookies
  // across google.com domains, which triggers accounts.google.com/CookieMismatch
  const cookieHeader = formatCookieHeader(await context.cookies(NOTEBOOKLM_BASE_URL))
  return cookieHeader || null
}

async function launchProfileContext(profileDir: string, headless: boolean) {
  const { chromium } = await import('playwright')
  const options = {
    headless,
    viewport: headless ? null : { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  }

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: 'chrome',
    })
  } catch {
    return chromium.launchPersistentContext(profileDir, options)
  }
}

export async function readProfileCookieHeader(
  profileDir = DEFAULT_PROFILE_DIR,
): Promise<string | null> {
  if (process.env.VITEST) return null

  let context
  try {
    context = await launchProfileContext(profileDir, true)
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(NOTEBOOKLM_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    return await cookieHeaderFromContext(context, await page.content())
  } catch {
    return null
  } finally {
    await context?.close().catch(() => {})
  }
}

export async function runHeadedNotebooklmLogin(options?: {
  interactive?: boolean
  profileDir?: string
}): Promise<string | null> {
  if (process.env.VITEST) return null

  const profileDir = options?.profileDir ?? DEFAULT_PROFILE_DIR
  fs.mkdirSync(profileDir, { recursive: true })

  const context = await launchProfileContext(profileDir, false)
  try {
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    if (options?.interactive) {
      console.log(`Profile dir: ${profileDir}`)
      console.log('Complete login in the browser window, then press Resume in the inspector.')
      await page.pause()
      return cookieHeaderFromContext(context, await page.content())
    }

    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    while (Date.now() < deadline) {
      const html = await page.content()
      const cookieHeader = await cookieHeaderFromContext(context, html)
      if (cookieHeader) return cookieHeader
      await page.waitForTimeout(LOGIN_POLL_MS)
    }
    return null
  } finally {
    await context.close()
  }
}

export async function ensureNotebooklmProfileLogin(): Promise<string | null> {
  if (process.env.VITEST || process.env.NOTEBOOKLM_COOKIE) return null
  if (Date.now() - lastFailedLoginAt < LOGIN_COOLDOWN_MS) return null

  if (!loginPromise) {
    loginPromise = runHeadedNotebooklmLogin()
      .then((cookieHeader) => {
        if (!cookieHeader) lastFailedLoginAt = Date.now()
        return cookieHeader
      })
      .finally(() => {
        loginPromise = null
      })
  }

  return loginPromise
}

export function resetLoginCooldownForTests() {
  lastFailedLoginAt = 0
  loginPromise = null
}
