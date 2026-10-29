import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import { getDbPath } from '../src/db/paths'
import {
  RedditSessionError,
  isSavedListing,
  savedListingUrl,
  sessionBlockedReason,
  walkSavedPages,
  type MappedRedditSaved,
} from '../src/server/reddit-client'
import { upsertRedditSavedItems } from '../src/server/reddit-saved-api'
import { chooseSavedHost, launchRedditProfile, readPageBody } from './reddit-browser'

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 1000))
}

function existingRedditNames() {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) return new Set<string>()
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare(`SELECT reddit_name FROM reddit_saved_items`).all() as { reddit_name: string }[]
    return new Set(rows.map((row) => row.reddit_name))
  } finally {
    db.close()
  }
}

const { values } = parseArgs({
  options: {
    limit: { type: 'string', default: '0' },
    'dry-run': { type: 'boolean', default: false },
    headless: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
  },
})

const limit = Number(values.limit)
if (!Number.isInteger(limit) || limit < 0) {
  console.error('--limit must be a non-negative integer')
  process.exit(1)
}

const dryRun = values['dry-run'] === true
const refresh = values.refresh === true

try {
  const known = refresh ? new Set<string>() : existingRedditNames()
  const fresh: MappedRedditSaved[] = []
  const context = await launchRedditProfile(values.headless === true)
  try {
    const page = context.pages()[0] ?? await context.newPage()
    const chosen = await chooseSavedHost(page)
    const result = await walkSavedPages(async (after) => {
      await pause()
      const response = await readPageBody(page, savedListingUrl(chosen.root, after))
      const blocked = sessionBlockedReason(response)
      if (blocked || !isSavedListing(response.body)) {
        throw new RedditSessionError(
          `Reddit saved listing failed (${blocked ?? `HTTP ${response.status}`})`,
        )
      }
      return response.body
    }, {
      initialBody: chosen.first.body,
      stopAfterPage(pageItems) {
        const novel = refresh ? pageItems : pageItems.filter((item) => !known.has(item.reddit_name))
        for (const item of novel) {
          if (limit > 0 && fresh.length >= limit) break
          fresh.push(item)
          known.add(item.reddit_name)
        }
        if (limit > 0 && fresh.length >= limit) return true
        return !refresh && pageItems.length > 0 && novel.length === 0
      },
    })
    if (!dryRun && fresh.length > 0) upsertRedditSavedItems(fresh)
    console.log(JSON.stringify({
      fetched: fresh.length,
      pages: result.pages,
      truncated: result.truncated,
      dryRun,
    }, null, 2))
    if (dryRun) {
      for (const item of fresh) console.log(`${item.reddit_name} ${item.title}`)
    }
  } finally {
    await context.close()
  }
} catch (error) {
  if (error instanceof RedditSessionError) {
    console.error(`HARD STOP: ${error.message}`)
    process.exit(2)
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
