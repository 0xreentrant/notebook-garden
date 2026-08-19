import { describe, expect, it } from 'vitest'
import { APP_TABS, HOME_PATH } from '../src/lib/app-tabs'

describe('app tabs', () => {
  it('exposes the four main paths and home default', () => {
    expect(HOME_PATH).toBe('/youtube')
    expect(APP_TABS.map((tab) => tab.path)).toEqual([
      '/youtube',
      '/bookmarks',
      '/linkedin',
      '/notebooks',
    ])
  })

  it('keeps human-readable labels', () => {
    expect(APP_TABS.map((tab) => tab.label)).toEqual([
      'YouTube',
      'Bookmarks',
      'LinkedIn Saved',
      'Notebooks',
    ])
  })
})
