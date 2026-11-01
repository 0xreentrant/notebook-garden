import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  contentHash,
  hardStopReason,
  kindFromUrn,
  linkedinUrlForUrn,
  normalizeContent,
  type AuthSignals,
} from '../src/server/linkedin-collect'
import { upsertLinkedInCapture, type LinkedInCapture } from '../src/server/linkedin-saved-api'
import { createTestDb } from './helpers/test-db'

const clearSignals: AuthSignals = {
  url: 'https://www.linkedin.com/my-items/saved-posts/',
  title: 'Saved',
  loggedOut: false,
  checkpoint: false,
  restricted: false,
}

function sample(content: string): LinkedInCapture {
  return {
    linkedin_urn: 'urn:li:activity:1',
    item_type: 'activity',
    linkedin_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
    title: 'Hello',
    content_text: content,
    content_hash: contentHash(content),
    capture_status: 'complete',
    raw_metadata: { view: 'a' },
  }
}

describe('linkedin collect helpers', () => {
  let dbPath = ''
  let cleanup = () => {}

  afterEach(() => {
    cleanup()
    if (process.env.APP_DB === dbPath) delete process.env.APP_DB
  })

  it('normalizes text, hashes it, and classifies auth and urns', () => {
    expect(normalizeContent('hello   world\r\n\r\n\r\nnext… see more')).toBe('hello world\n\nnext')
    expect(contentHash('body one')).toBe(createHash('sha256').update('body one').digest('hex'))
    expect(contentHash('   ')).toBeNull()
    expect(kindFromUrn('urn:li:article:9')).toBe('article')
    expect(kindFromUrn('urn:li:activity:9')).toBe('activity')
    expect(kindFromUrn('urn:li:share:9')).toBe('unknown')
    expect(linkedinUrlForUrn('urn:li:activity:9')).toBe('https://www.linkedin.com/feed/update/urn:li:activity:9/')
    expect(hardStopReason({ ...clearSignals, loggedOut: true, checkpoint: true })).toBe('logged_out')
    expect(hardStopReason({ ...clearSignals, checkpoint: true })).toBe('checkpoint')
    expect(hardStopReason({ ...clearSignals, restricted: true })).toBe('restricted')
    expect(hardStopReason(clearSignals)).toBeNull()
  })

  it('inserts, skips a complete row, and resets enrichment when refresh changes the hash', () => {
    const created = createTestDb()
    dbPath = created.dbPath
    cleanup = created.cleanup
    process.env.APP_DB = dbPath

    const item = sample('body one')
    expect(upsertLinkedInCapture(item)).toBe('inserted')
    expect(upsertLinkedInCapture(item)).toBe('skipped')

    const db = new Database(dbPath)
    db.prepare(
      `UPDATE linkedin_saved_items SET enrichment_status = 'complete', summary_text = 'old' WHERE linkedin_urn = ?`,
    ).run(item.linkedin_urn)
    db.close()

    const changed = sample('body two')
    expect(upsertLinkedInCapture(changed, true)).toBe('updated')

    const read = new Database(dbPath, { readonly: true })
    const row = read.prepare(
      `SELECT enrichment_status, summary_text, content_text FROM linkedin_saved_items WHERE linkedin_urn = ?`,
    ).get(item.linkedin_urn) as {
      enrichment_status: string
      summary_text: string | null
      content_text: string
    }
    read.close()
    expect(row.enrichment_status).toBe('pending')
    expect(row.summary_text).toBeNull()
    expect(row.content_text).toBe('body two')
  })
})
