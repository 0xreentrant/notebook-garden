import { describe, expect, it } from 'vitest'
import {
  buildAddSourceSpec,
  isYouTubeUrl,
  parseNotebookList,
  parseSourceCount,
  resolveNotebooklmBaseUrl,
  DEFAULT_NOTEBOOKLM_BASE_URL,
} from '../src/server/notebooklm/notebooklm'

describe('notebooklm parsers', () => {
  it('parses source count for ready sources only', () => {
    const count = parseSourceCount([
      'Title',
      [
        [1, 2, 3, [null, 2]],
        [1, 2, 3, [null, 3]],
      ],
      'uuid',
    ])
    expect(count).toBe(1)
  })

  it('parses notebook list metadata', () => {
    const list = parseNotebookList([[[
      'Title',
      [],
      '00000000-0000-4000-8000-000000000001',
      null,
      null,
      [1, false, null, null, null, [1704067200, 0], null, null, [1609459200, 0]],
    ]]])
    expect(list).toHaveLength(1)
    expect(list[0]?.notebooklmId).toBe('00000000-0000-4000-8000-000000000001')
    expect(list[0]?.source_count).toBe(0)
  })
})

describe('resolveNotebooklmBaseUrl', () => {
  it('defaults to notebook.google.com', () => {
    expect(resolveNotebooklmBaseUrl({})).toBe(DEFAULT_NOTEBOOKLM_BASE_URL)
  })

  it('reads NOTEBOOKLM_BASE_URL and strips trailing slash', () => {
    expect(resolveNotebooklmBaseUrl({ NOTEBOOKLM_BASE_URL: 'https://example.test/' }))
      .toBe('https://example.test')
  })
})

describe('buildAddSourceSpec', () => {
  it('puts YouTube URLs at index 7', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isYouTubeUrl('https://youtu.be/abc')).toBe(true)
    expect(buildAddSourceSpec('https://www.youtube.com/watch?v=abc')).toEqual([
      null, null, null, null, null, null, null, ['https://www.youtube.com/watch?v=abc'],
    ])
  })

  it('puts web URLs at index 2', () => {
    expect(isYouTubeUrl('https://example.com/essay')).toBe(false)
    expect(buildAddSourceSpec('https://example.com/essay')).toEqual([
      null, null, ['https://example.com/essay'],
    ])
  })
})
