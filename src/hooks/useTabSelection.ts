import { useCallback, useEffect, useRef, useState } from 'react'

export const CONNECTOR_TABS = ['youtube', 'bookmarks', 'linkedin', 'reddit'] as const

export type ConnectorTab = (typeof CONNECTOR_TABS)[number]

export type SelectionTab = ConnectorTab | 'notebooks'

export type SelectedResource = {
  connector: ConnectorTab
  id: number
  title: string
  url: string
  key: string
}

const selections = new Map<SelectionTab, Set<number>>()
const snapshots = new Map<ConnectorTab, Map<number, { title: string; url: string }>>()

function isConnector(tab: SelectionTab): tab is ConnectorTab {
  return tab !== 'notebooks'
}

function bucket(tab: SelectionTab) {
  let set = selections.get(tab)
  if (!set) {
    set = new Set()
    selections.set(tab, set)
  }
  return set
}

export function readSelectedIds(tab: SelectionTab) {
  return bucket(tab)
}

export function toggleSelectedId(
  tab: SelectionTab,
  id: number,
  checked: boolean,
  snapshot?: { title: string; url: string },
) {
  const next = new Set(bucket(tab))
  if (checked) next.add(id)
  else next.delete(id)
  selections.set(tab, next)
  if (isConnector(tab)) {
    const stored = snapshots.get(tab) ?? new Map<number, { title: string; url: string }>()
    if (checked && snapshot) stored.set(id, snapshot)
    if (!checked) stored.delete(id)
    snapshots.set(tab, stored)
  }
  return next
}

export function selectedConnectorResources(): SelectedResource[] {
  const resources: SelectedResource[] = []
  for (const connector of CONNECTOR_TABS) {
    const stored = snapshots.get(connector)
    for (const id of bucket(connector)) {
      const snapshot = stored?.get(id)
      if (!snapshot?.url) continue
      resources.push({
        connector,
        id,
        title: snapshot.title,
        url: snapshot.url,
        key: `${connector}:${id}`,
      })
    }
  }
  return resources
}

export function clearConnectorSelections() {
  for (const tab of CONNECTOR_TABS) {
    selections.set(tab, new Set())
    snapshots.delete(tab)
  }
}

export function clearSelectedIds(tab: SelectionTab) {
  const next = new Set<number>()
  selections.set(tab, next)
  return next
}

export function resetTabSelections() {
  selections.clear()
  snapshots.clear()
}

// Checklist confirm and cancel leave the connector checks in place.
export function keepSelectionAfterSourceChecklist(tab: SelectionTab) {
  return bucket(tab)
}

// ponytail: drop a check only after this mount has shown that row and it left the loaded list.
// A tab remount starts from an empty seen set, so checks survive the first page reload.
// Upgrade path: stop pruning on filter changes if off-screen checks should survive those too.
export function syncSelectionToLoadedItems(
  tab: SelectionTab,
  loadedIds: number[],
  loading: boolean,
  seenIds: ReadonlySet<number>,
) {
  const current = bucket(tab)
  if (loading && loadedIds.length === 0) {
    return { selected: current, seen: new Set(seenIds) }
  }
  const loaded = new Set(loadedIds)
  const seen = new Set(seenIds)
  for (const id of loaded) seen.add(id)
  let removed = false
  const next = new Set<number>()
  for (const id of current) {
    if (seenIds.has(id) && !loaded.has(id)) {
      removed = true
      if (isConnector(tab)) snapshots.get(tab)?.delete(id)
      continue
    }
    next.add(id)
  }
  if (!removed) return { selected: current, seen }
  selections.set(tab, next)
  return { selected: next, seen }
}

export function useTabSelection<T extends { id: number }>(
  tab: SelectionTab,
  items: T[],
  loading: boolean,
) {
  const [selectedIds, setSelectedIds] = useState(() => readSelectedIds(tab))
  const seenRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    const synced = syncSelectionToLoadedItems(
      tab,
      items.map((item) => item.id),
      loading,
      seenRef.current,
    )
    seenRef.current = synced.seen
    setSelectedIds(synced.selected)
  }, [tab, items, loading])

  const toggleSelected = useCallback((
    id: number,
    checked: boolean,
    snapshot?: { title: string; url: string },
  ) => {
    setSelectedIds(toggleSelectedId(tab, id, checked, snapshot))
  }, [tab])

  const clearSelection = useCallback(() => {
    seenRef.current = new Set()
    setSelectedIds(clearSelectedIds(tab))
  }, [tab])

  const rememberSelection = useCallback(() => {
    setSelectedIds(keepSelectionAfterSourceChecklist(tab))
  }, [tab])

  return { selectedIds, toggleSelected, clearSelection, rememberSelection }
}
