import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

const DEFAULT_ESTIMATE = 180
const OVERSCAN = 8
const LOAD_MORE_THRESHOLD = 5

export type VirtualRow =
  | { type: 'header'; key: string; label: string }
  | { type: 'item'; key: string; index: number }
  | { type: 'status'; key: string }

export function buildPinnedRows<T extends { id: number; pinned: number | boolean }>(
  items: T[],
  pinsAtTop: boolean,
  labels: { pinned: string; rest: string },
  options?: { showStatus?: boolean },
): VirtualRow[] {
  const rows: VirtualRow[] = []
  if (!pinsAtTop) {
    items.forEach((_, index) => {
      rows.push({ type: 'item', key: `item-${items[index].id}`, index })
    })
  } else {
    const pinnedIndexes: number[] = []
    const normalIndexes: number[] = []
    items.forEach((item, index) => {
      if (item.pinned) pinnedIndexes.push(index)
      else normalIndexes.push(index)
    })
    if (pinnedIndexes.length > 0) {
      rows.push({ type: 'header', key: 'header-pinned', label: labels.pinned })
      for (const index of pinnedIndexes) {
        rows.push({ type: 'item', key: `item-${items[index].id}`, index })
      }
    }
    if (normalIndexes.length > 0) {
      if (pinnedIndexes.length > 0) {
        rows.push({ type: 'header', key: 'header-rest', label: labels.rest })
      }
      for (const index of normalIndexes) {
        rows.push({ type: 'item', key: `item-${items[index].id}`, index })
      }
    }
  }
  if (options?.showStatus) {
    rows.push({ type: 'status', key: 'status' })
  }
  return rows
}

export function VirtualizedList({
  rows,
  estimateSize = DEFAULT_ESTIMATE,
  hasMore,
  loadingMore,
  onLoadMore,
  renderRow,
  className,
}: {
  rows: VirtualRow[]
  estimateSize?: number | ((row: VirtualRow) => number)
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  renderRow: (row: VirtualRow) => ReactNode
  className?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const loadingMoreRef = useRef(loadingMore)
  loadingMoreRef.current = loadingMore

  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0)
  }, [rows.length])

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index]
      if (!row) return DEFAULT_ESTIMATE
      if (typeof estimateSize === 'function') return estimateSize(row)
      if (row.type === 'header') return 28
      if (row.type === 'status') return 48
      return estimateSize
    },
    overscan: OVERSCAN,
    scrollMargin,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastItem = virtualItems.at(-1)

  useEffect(() => {
    if (!lastItem || !hasMore || loadingMoreRef.current) return
    if (lastItem.index >= rows.length - LOAD_MORE_THRESHOLD) {
      onLoadMore()
    }
  }, [hasMore, lastItem, onLoadMore, rows.length])

  return (
    <div ref={listRef} className={className}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index]
          if (!row) return null
          return (
            <div
              key={row.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                paddingBottom: row.type === 'status' ? 0 : 16,
              }}
            >
              {renderRow(row)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
