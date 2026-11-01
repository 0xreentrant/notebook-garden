import {
  SAVED_URL,
  authSignals,
  hardStopReason,
} from '../src/server/linkedin-collect'
import { launchLinkedInProfile, linkedinProfileDir } from './linkedin-browser'

const context = await launchLinkedInProfile(false)
let exitCode = 0
try {
  const page = context.pages()[0] ?? await context.newPage()
  console.error(`Profile: ${linkedinProfileDir()}`)
  console.error('Complete LinkedIn login in Chrome if needed.')
  await page.goto(SAVED_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(3000)
  let reason = hardStopReason(await authSignals(page))
  if (reason) {
    console.error(`Auth state: ${reason}. Log in, reach Saved Posts, then wait.`)
    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000)
      const signals = await authSignals(page)
      reason = hardStopReason(signals)
      if (!reason && page.url().includes('saved-posts')) break
      if (page.url().includes('/feed') && !page.url().includes('saved-posts')) {
        await page.goto(SAVED_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      }
    }
    reason = hardStopReason(await authSignals(page))
  }
  if (reason || !page.url().includes('saved-posts')) {
    console.error(`Login incomplete (${reason || page.url()})`)
    exitCode = 1
  } else {
    console.error(`OK: ${await page.title()} @ ${page.url()}`)
    console.log('LinkedIn saved login OK')
    await page.waitForTimeout(2000)
  }
} finally {
  await context.close()
}
if (exitCode) process.exit(exitCode)
