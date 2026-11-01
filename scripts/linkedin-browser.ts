import { chmodSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function linkedinProfileDir() {
  return process.env.LI_PROFILE_DIR
    ?? path.join(os.homedir(), '.config/linkedin-saved/chrome-profile')
}

export async function launchLinkedInProfile(headless: boolean) {
  const profileDir = linkedinProfileDir()
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
    return chromium.launchPersistentContext(profileDir, options)
  }
}
