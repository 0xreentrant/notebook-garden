import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  insertEntry,
  request,
  type Harness,
} from './helpers/harness'

describe('6. Interests / settings QoL', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  afterEach(() => {
    h.cleanup()
  })

  it('saves and reloads the Obsidian vault path via settings API', async () => {
    const bad = await request(h.app, 'http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obsidianVault: 123 }),
    })
    expect(bad.status).toBe(400)

    const saved = await request(h.app, 'http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obsidianVault: ' /vaults/garden ' }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ obsidianVault: '/vaults/garden' })

    const loaded = await request(h.app, 'http://localhost/api/settings')
    expect(loaded.status).toBe(200)
    expect(await loaded.json()).toEqual({ obsidianVault: '/vaults/garden' })

    const settingsFile = path.join(path.dirname(h.dbPath), 'notebook-garden-settings.json')
    expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).toEqual({
      obsidianVault: '/vaults/garden',
    })
  })

  it('serves meta-analysis status through the API', async () => {
    const res = await request(h.app, 'http://localhost/api/meta-analysis')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      cacheHit: false,
      analysis: null,
      generating: false,
    })
  })
})
