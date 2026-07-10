import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildListQueryString,
  type ListPage,
  type ListPageQuery,
} from '@/lib/list-page'

type ListFilters = Omit<ListPageQuery, 'limit' | 'cursor'>

export function useInfiniteList<T extends { id: number }>(
  endpoint: string,
  filters: ListFilters,
) {
  const [items, setItems] = useState<T[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const queryKey = buildListQueryString(filters)

  const fetchPage = useCallback(async (cursor: string | null) => {
    const qs = buildListQueryString({ ...filtersRef.current, cursor })
    const response = await fetch(`${endpoint}?${qs}`)
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error ?? `HTTP ${response.status}`)
    }
    return response.json() as Promise<ListPage<T>>
  }, [endpoint])

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    setLoadMoreError(null)
    try {
      const page = await fetchPage(null)
      if (requestId !== requestIdRef.current) return
      setItems(page.items)
      setTags(page.tags)
      setTotal(page.total)
      setNextCursor(page.nextCursor)
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
      setItems([])
      setNextCursor(null)
      setTotal(0)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [fetchPage])

  useEffect(() => {
    void reload()
  }, [queryKey, reload])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current || loading) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    const requestId = requestIdRef.current
    try {
      const page = await fetchPage(nextCursor)
      if (requestId !== requestIdRef.current) return
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id))
        const appended = page.items.filter((item) => !seen.has(item.id))
        return appended.length === 0 ? current : [...current, ...appended]
      })
      setTags(page.tags)
      setTotal(page.total)
      setNextCursor(page.nextCursor)
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return
      setLoadMoreError(fetchError instanceof Error ? fetchError.message : String(fetchError))
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage, loading, nextCursor])

  const replaceItem = useCallback((updated: T) => {
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    )
  }, [])

  const removeItem = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
    setTotal((current) => Math.max(0, current - 1))
  }, [])

  return {
    items,
    tags,
    total,
    hasMore: nextCursor != null,
    loading,
    loadingMore,
    error,
    loadMoreError,
    loadMore,
    reload,
    replaceItem,
    removeItem,
    setError,
  }
}
