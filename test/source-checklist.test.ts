import { beforeEach, describe, expect, it } from 'vitest'
import {
  keepSelectionAfterSourceChecklist,
  readSelectedIds,
  resetTabSelections,
  selectedConnectorResources,
  syncSelectionToLoadedItems,
  toggleSelectedId,
} from '../src/hooks/useTabSelection'
import {
  planResourceSources,
  urlsFromChecklist,
} from '../src/lib/source-checklist'

function resources(count: number, start = 1) {
  return Array.from({ length: count }, (_, index) => {
    const id = start + index
    return { id, title: `Item ${id}`, url: `https://example.com/${id}` }
  })
}

function ids(tab: 'youtube' | 'bookmarks' | 'notebooks') {
  return [...readSelectedIds(tab)].sort((a, b) => a - b)
}

describe('source cap checklist and connector selection', () => {
  beforeEach(() => {
    resetTabSelections()
  })

  it('offers a checklist when selected resources would pass 50 sources', () => {
    const fresh = planResourceSources({
      destinationSourceCount: 0,
      resources: resources(51),
    })
    expect(fresh.action).toBe('checklist')
    if (fresh.action !== 'checklist') return
    expect(fresh.projected).toBe(51)
    expect(fresh.cap).toBe(50)
    expect(fresh.choices.filter((choice) => choice.role === 'add')).toHaveLength(51)

    const existing = planResourceSources({
      destinationSourceCount: 48,
      resources: resources(3),
    })
    expect(existing.action).toBe('checklist')

    const under = planResourceSources({
      destinationSourceCount: 48,
      resources: resources(2),
    })
    expect(under.action).toBe('add')
    if (under.action !== 'add') return
    expect(under.urls).toHaveLength(2)

    const trimmed = urlsFromChecklist(fresh, new Set(fresh.choices.slice(0, 50).map((choice) => choice.key)))
    expect(trimmed.withinCap).toBe(true)
    expect(trimmed.projected).toBe(50)
    expect(trimmed.urls).toHaveLength(50)

    const stillOver = urlsFromChecklist(
      fresh,
      new Set(fresh.choices.map((choice) => choice.key)),
    )
    expect(stillOver.withinCap).toBe(false)
    expect(stillOver.projected).toBe(51)
  })

  it('keeps connector checks after the checklist and across tabs', () => {
    toggleSelectedId('youtube', 4, true)
    toggleSelectedId('youtube', 7, true)
    toggleSelectedId('bookmarks', 4, true)
    toggleSelectedId('notebooks', 9, true)

    expect(ids('youtube')).toEqual([4, 7])
    expect(ids('bookmarks')).toEqual([4])
    expect(ids('notebooks')).toEqual([9])

    const duringReload = syncSelectionToLoadedItems('youtube', [], true, new Set())
    expect([...duringReload.selected].sort((a, b) => a - b)).toEqual([4, 7])

    const firstPage = syncSelectionToLoadedItems('youtube', [4], false, new Set())
    expect([...firstPage.selected].sort((a, b) => a - b)).toEqual([4, 7])

    expect([...keepSelectionAfterSourceChecklist('youtube')].sort((a, b) => a - b)).toEqual([4, 7])
    expect(ids('bookmarks')).toEqual([4])
    expect(ids('notebooks')).toEqual([9])

    toggleSelectedId('youtube', 4, true, { title: 'Video', url: 'https://youtu.be/a' })
    toggleSelectedId('bookmarks', 4, true, { title: 'Essay', url: 'https://example.com/essay' })
    toggleSelectedId('reddit', 4, true, { title: 'Post', url: 'https://example.com/post' })
    expect(selectedConnectorResources().map((resource) => resource.key)).toEqual([
      'youtube:4',
      'bookmarks:4',
      'reddit:4',
    ])
  })

  it('drops a check only after that row was shown and then left the list', () => {
    toggleSelectedId('youtube', 1, true)
    toggleSelectedId('youtube', 2, true)
    const seen = syncSelectionToLoadedItems('youtube', [1, 2], false, new Set()).seen
    const next = syncSelectionToLoadedItems('youtube', [2], false, seen)
    expect([...next.selected]).toEqual([2])
  })
})
