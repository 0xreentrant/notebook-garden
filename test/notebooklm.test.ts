import { describe, expect, it } from 'vitest'
import { parseNotebookList, parseSourceCount } from '../src/server/notebooklm/notebooklm'

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
