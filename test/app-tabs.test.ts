import { describe, expect, it } from 'vitest'
import { APP_TABS, HOME_PATH } from '../src/lib/app-tabs'

describe('app tabs', () => {
  it('exposes the four main paths and home default', () => {
    expect(HOME_PATH).toBe('/summaries')
    expect(APP_TABS.map((tab) => tab.path)).toEqual([
      '/summaries',
      '/bookmarks',
      '/linkedin',
      '/library',
    ])
  })

  it('keeps human-readable labels', () => {
    expect(APP_TABS.map((tab) => tab.label)).toEqual([
      'Summaries',
      'Bookmarks',
      'LinkedIn Saved',
      'Library',
    ])
  })
})
