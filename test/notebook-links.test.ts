import { describe, expect, it } from 'vitest'
import {
  appendNotebookLink,
  parseNotebookLinks,
  serializeNotebookLinks,
  truncateNotebookTitle,
} from '../src/lib/notebook-links'

describe('notebook links', () => {
  it('truncates titles longer than 25 characters', () => {
    expect(truncateNotebookTitle('Short title')).toBe('Short title')
    expect(truncateNotebookTitle('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(
      'ABCDEFGHIJKLMNOPQRSTUVWXY…',
    )
  })

  it('appends unique links and updates title on duplicate url', () => {
    const first = appendNotebookLink([], {
      url: 'https://notebooklm.google.com/notebook/a',
      title: 'Alpha',
    })
    const second = appendNotebookLink(first, {
      url: 'https://notebooklm.google.com/notebook/b',
      title: 'Beta',
    })
    const updated = appendNotebookLink(second, {
      url: 'https://notebooklm.google.com/notebook/a',
      title: 'Alpha renamed',
    })
    expect(updated).toEqual([
      { url: 'https://notebooklm.google.com/notebook/a', title: 'Alpha renamed' },
      { url: 'https://notebooklm.google.com/notebook/b', title: 'Beta' },
    ])
    expect(parseNotebookLinks(serializeNotebookLinks(updated))).toEqual(updated)
  })
})
