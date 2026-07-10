import {
  ensureNotebooklmProfileLogin,
  formatCookieHeader,
  readProfileCookieHeader,
} from './notebooklm-login'

export { formatCookieHeader }

export const NOTEBOOKLM_AUTH_ERROR =
  'Not logged into NotebookLM. Log into notebooklm.google.com in the Playwright profile (YT_PROFILE_DIR), or set NOTEBOOKLM_COOKIE.'

let cachedCookie: string | null = null
let refreshPromise: Promise<string> | null = null

export function invalidateNotebooklmCookieCache() {
  cachedCookie = null
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not authorized|NOTEBOOKLM_COOKIE|login to NotebookLM|Not logged into NotebookLM/i.test(message)
}

async function exportCookieFromProfile(allowHeadedLogin = true): Promise<string> {
  if (process.env.VITEST) {
    throw new Error(NOTEBOOKLM_AUTH_ERROR)
  }

  const cookieHeader = await readProfileCookieHeader()
  if (cookieHeader) return cookieHeader

  if (allowHeadedLogin && !process.env.NOTEBOOKLM_COOKIE) {
    const cookieFromLogin = await ensureNotebooklmProfileLogin()
    if (cookieFromLogin) return cookieFromLogin
  }

  throw new Error(NOTEBOOKLM_AUTH_ERROR)
}

export async function resolveNotebooklmCookie(forceRefresh = false): Promise<string> {
  const envCookie = process.env.NOTEBOOKLM_COOKIE
  if (envCookie) return envCookie

  if (!forceRefresh && cachedCookie) return cachedCookie

  if (!refreshPromise) {
    refreshPromise = exportCookieFromProfile()
      .then((cookie) => {
        cachedCookie = cookie
        return cookie
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

export async function withNotebooklmCookie<T>(
  fn: (cookie: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await resolveNotebooklmCookie())
  } catch (error) {
    if (!isAuthError(error) || process.env.NOTEBOOKLM_COOKIE) throw error
    invalidateNotebooklmCookieCache()
    const cookieFromLogin = await ensureNotebooklmProfileLogin()
    if (cookieFromLogin) {
      cachedCookie = cookieFromLogin
      return fn(cookieFromLogin)
    }
    throw error
  }
}
