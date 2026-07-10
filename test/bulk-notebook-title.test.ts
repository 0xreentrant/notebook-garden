import { describe, expect, it } from 'vitest'
import { defaultBulkNotebookTitle } from '../src/notebooklm-importer'

describe('defaultBulkNotebookTitle', () => {
  it('uses the single entry title', () => {
    expect(defaultBulkNotebookTitle([{ title: 'One video' }])).toBe('One video')
  })

  it('uses a count label for multiple entries', () => {
    expect(
      defaultBulkNotebookTitle([{ title: 'A' }, { title: 'B' }, { title: 'C' }]),
    ).toBe('Imported videos (3)')
  })
})
