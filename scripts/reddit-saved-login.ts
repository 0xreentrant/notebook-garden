import { RedditSessionError, redditProfileDir } from '../src/server/reddit-client'
import { chooseSavedHost, launchRedditProfile } from './reddit-browser'

const LOGIN_URL = 'https://www.reddit.com/login/'

function rateLimited(text: string) {
  return /http error 429|too many requests/i.test(text)
}

const context = await launchRedditProfile(false)
let exitCode = 0
try {
  const page = context.pages()[0] ?? await context.newPage()
  console.error(`Profile: ${redditProfileDir()}`)
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {})
  console.error('Sign in in the Chrome window. This does not reload the page.')
  const deadline = Date.now() + 5 * 60 * 1000
  let loggedIn = false
  let settledUrl = ''
  let seen = 0
  while (Date.now() < deadline && !loggedIn && exitCode === 0) {
    await page.waitForTimeout(3000)
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')
    if (rateLimited(text)) {
      console.error('Reddit returned 429. Not retrying.')
      exitCode = 2
      break
    }
    const url = page.url().toLowerCase()
    if (url.includes('/login') || url.includes('/register') || url.startsWith('about:')) {
      settledUrl = ''
      seen = 0
      continue
    }
    if (url === settledUrl) seen += 1
    else {
      settledUrl = url
      seen = 1
    }
    if (seen < 2) continue
    try {
      await chooseSavedHost(page)
      loggedIn = true
    } catch (error) {
      if (!(error instanceof RedditSessionError)) throw error
      console.error(error.message.includes('429')
        ? 'Reddit returned 429. Not retrying.'
        : `Reddit saved login failed: ${error.message}`)
      exitCode = error.message.includes('429') ? 2 : 1
    }
  }
  if (!loggedIn && exitCode === 0) {
    console.error('Reddit saved login timed out')
    exitCode = 1
  }
  if (loggedIn) console.log('Reddit saved login OK')
} finally {
  await context.close()
}
if (exitCode) process.exit(exitCode)
