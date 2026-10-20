import { describe, expect, it } from 'vitest'
import {
  buildMergeChecklist,
  candidateFromSourceRow,
  limitPlanToUrls,
  planNotebookSourceMerge,
  sourceCapExceeded,
  sourceRowsFromGetNotebook,
} from '../src/server/notebooklm/notebook-merge'

describe('planNotebookSourceMerge', () => {
  it('copies unique urls, skips duplicates and url-less sources, and rejects the source cap', () => {
    const plan = planNotebookSourceMerge({
      destinationSourceCount: 2,
      destinationUrls: ['https://www.youtube.com/watch?v=abc'],
      incoming: [
        { title: 'Dup', url: 'https://youtu.be/abc' },
        { title: 'Web', url: 'https://example.com/a' },
        { title: 'Notes', url: null },
        { title: 'Again', url: 'https://example.com/a/' },
      ],
      cap: 4,
    })

    expect(plan.urlsToAdd).toEqual(['https://example.com/a'])
    expect(plan.skipped).toEqual([
      { title: 'Dup', reason: 'duplicate' },
      { title: 'Notes', reason: 'no-url' },
      { title: 'Again', reason: 'duplicate' },
    ])
    expect(plan.projectedCount).toBe(3)
    expect(plan.error).toBeNull()

    const over = planNotebookSourceMerge({
      destinationSourceCount: 4,
      destinationUrls: [],
      incoming: [
        { title: 'A', url: 'https://example.com/a' },
        { title: 'B', url: 'https://example.com/b' },
      ],
      cap: 5,
    })
    expect(over.urlsToAdd).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(over.projectedCount).toBe(6)
    expect(over.error).toBe('Merge would put 6 sources on the destination, over the 5 source cap.')

    const trimmed = limitPlanToUrls(over, ['https://example.com/b'])
    expect(trimmed.urlsToAdd).toEqual(['https://example.com/b'])
    expect(trimmed.projectedCount).toBe(5)
    expect(trimmed.error).toBeNull()

    expect(sourceCapExceeded(50, ['https://example.com/a'])).toBe(
      'This would put 51 sources on the notebook, over the 50 source cap.',
    )
    expect(sourceCapExceeded(49, ['https://example.com/a'])).toBeNull()
  })

  it('lists destination sources as locked and incoming urls as add or skip', () => {
    const choices = buildMergeChecklist({
      destination: {
        title: 'Dest',
        sources: [{ title: 'Kept', url: 'https://example.com/kept' }],
      },
      incoming: [
        {
          title: 'Other',
          sources: [
            { title: 'Kept again', url: 'https://example.com/kept/' },
            { title: 'New', url: 'https://example.com/new' },
            { title: 'Notes', url: null },
          ],
        },
      ],
    })

    expect(choices.map((choice) => [choice.role, choice.title])).toEqual([
      ['destination', 'Kept'],
      ['duplicate', 'Kept again'],
      ['add', 'New'],
      ['no-url', 'Notes'],
    ])
  })

  it('reads web and youtube urls from a GET_NOTEBOOK source list', () => {
    const detail = [[
      'Garden',
      [
        [
          ['web-id'],
          'Essay',
          [null, null, null, null, 5, null, null, ['https://example.com/essay']],
          [null, 2],
        ],
        [
          ['yt-id'],
          'Talk',
          [null, null, null, null, 9, ['https://www.youtube.com/watch?v=xyz']],
          [null, 2],
        ],
        [
          ['text-id'],
          'Pasted notes',
          [null, null, null, null, 4],
          [null, 2],
        ],
      ],
      '00000000-0000-4000-8000-000000000001',
    ]]

    const candidates = sourceRowsFromGetNotebook(detail).map(candidateFromSourceRow)
    expect(candidates).toEqual([
      { title: 'Essay', url: 'https://example.com/essay' },
      { title: 'Talk', url: 'https://www.youtube.com/watch?v=xyz' },
      { title: 'Pasted notes', url: null },
    ])
  })
})
