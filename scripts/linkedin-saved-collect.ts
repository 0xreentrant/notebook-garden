import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getDbPath } from '../src/db/paths'
import {
  SAVED_URL,
  authSignals,
  captureLinkedInCard,
  hardStopReason,
  scrollCollectUrns,
} from '../src/server/linkedin-collect'
import { existingLinkedInUrns, upsertLinkedInCapture } from '../src/server/linkedin-saved-api'
import { launchLinkedInProfile } from './linkedin-browser'

function pause() {
  const ms = 1400 + Math.random() * 800
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
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
if (values.db) process.env.APP_DB = path.resolve(values.db)

const dryRun = values['dry-run'] === true
const refresh = values.refresh === true
const dbPath = getDbPath()
if (!dryRun && !existsSync(dbPath)) {
  console.error(`DB missing: ${dbPath}`)
  process.exit(1)
}
const stored = dryRun ? new Set<string>() : existingLinkedInUrns()
const known = refresh ? new Set<string>() : stored

const context = await launchLinkedInProfile(values.headless === true)
let exitCode = 0
try {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(SAVED_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(3500)
  const stop = hardStopReason(await authSignals(page))
  if (stop) {
    console.error(`HARD STOP: ${stop}`)
    exitCode = 2
  } else {
    console.error('Harvesting URNs...')
    const urns = await scrollCollectUrns(page)
    console.error(`Found ${urns.length} saved URNs`)
    let targets = refresh ? urns : urns.filter((urn) => !known.has(urn))
    if (limit > 0) targets = targets.slice(0, limit)
    console.error(`Capturing ${targets.length} (dry_run=${dryRun})`)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(800)

    const results = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      items: [] as {
        urn: string
        type: string
        status: string
        error: string | null
        title: string
        content_len: number
        source_url: string | null
      }[],
    }
    for (let i = 0; i < targets.length; i += 1) {
      const urn = targets[i]
      const midStop = hardStopReason(await authSignals(page))
      if (midStop) {
        console.error(`HARD STOP mid-run: ${midStop}`)
        break
      }
      console.error(`[${i + 1}/${targets.length}] ${urn}`)
      const item = await captureLinkedInCard(context, page, urn)
      const summary = {
        urn,
        type: item.item_type,
        status: item.capture_status,
        error: item.capture_error ?? null,
        title: (item.title || '').slice(0, 80),
        content_len: (item.content_text || '').length,
        source_url: item.source_url ?? null,
      }
      results.items.push(summary)
      if (item.capture_status === 'error') results.errors += 1
      if (dryRun) {
        console.log(JSON.stringify(summary, null, 2))
      } else {
        const action = upsertLinkedInCapture(item, refresh)
        results[action] += 1
        console.error(`  -> ${action} ${item.capture_status}`)
      }
      await pause()
    }
    const { items, ...counts } = results
    console.log(JSON.stringify(counts, null, 2))
    console.log(JSON.stringify(items.slice(0, 20), null, 2))
    if (results.errors > 0) exitCode = 1
  }
} finally {
  await context.close()
}
if (exitCode) process.exit(exitCode)
