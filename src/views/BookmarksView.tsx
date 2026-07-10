import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  BookOpenIcon,
  ExternalLinkIcon,
  FolderIcon,
  PinIcon,
  RefreshCwIcon,
  TagPlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import {
  addVideosToNotebook,
  bulkCreateNotebookForVideos,
  createNotebookForVideo,
  defaultBulkBookmarkNotebookTitle,
  saveBookmarkNotebookUrl,
} from '@/notebooklm-importer'
import { fetchNotebooks } from '@/api/notebooks'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { useInfiniteList } from '@/hooks/useInfiniteList'
import {
  buildPinnedRows,
  VirtualizedList,
} from '@/components/VirtualizedList'
import {
  BOOKMARK_PINS_AT_TOP_KEY,
  formatTimestamp,
  readBookmarkPinsAtTop,
  selectClassName,
  type NotebookFilter,
  type SearchScope,
  type SortKey,
  type ViewFilter,
} from '@/lib/bookmark-list'
import { normalizeTag } from '@/lib/tags'
import { truncateNotebookTitle } from '@/lib/notebook-links'
import { searchNotebooks, sortNotebooks } from '@/lib/notebook-list'
import type { BookmarkRow, NotebookRow } from '@/types'

const fieldClassName =
  'h-8 w-full rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const checkboxClassName = 'size-3.5 shrink-0 rounded border-border accent-primary'

const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  selected,
  onSelectedChange,
  onDelete,
  onNotebookCreated,
  onViewed,
  onPinned,
  onTagsChange,
  allTags,
}: {
  bookmark: BookmarkRow
  selected: boolean
  onSelectedChange: (id: number, checked: boolean) => void
  onDelete: (id: number) => Promise<void>
  onNotebookCreated: (bookmark: BookmarkRow) => void
  onViewed: (bookmark: BookmarkRow) => void
  onPinned: (bookmark: BookmarkRow) => void
  onTagsChange: (bookmark: BookmarkRow, tags: string[]) => Promise<void>
  allTags: string[]
}) {
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagInputOpen, setTagInputOpen] = useState(false)

  async function markViewed() {
    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_viewed: true }),
      })
      if (!response.ok) return
      onViewed((await response.json()) as BookmarkRow)
    } catch {
      // fire-and-forget
    }
  }

  async function togglePinned() {
    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !bookmark.pinned }),
      })
      if (!response.ok) return
      onPinned((await response.json()) as BookmarkRow)
    } catch {
      // fire-and-forget
    }
  }

  const availableTags = useMemo(
    () =>
      allTags.filter(
        (tag) => !bookmark.tags.includes(tag) && tag.includes(normalizeTag(tagDraft)),
      ),
    [allTags, bookmark.tags, tagDraft],
  )

  async function addTag(event: FormEvent) {
    event.preventDefault()
    const tag = normalizeTag(tagDraft)
    if (!tag || bookmark.tags.includes(tag)) {
      setTagDraft('')
      return
    }
    await onTagsChange(bookmark, [...bookmark.tags, tag])
    setTagDraft('')
    setTagInputOpen(false)
  }

  async function selectExistingTag(tag: string) {
    if (bookmark.tags.includes(tag)) return
    await onTagsChange(bookmark, [...bookmark.tags, tag])
    setTagDraft('')
    setTagInputOpen(false)
  }

  async function removeTag(tag: string) {
    await onTagsChange(bookmark, bookmark.tags.filter((value) => value !== tag))
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete(bookmark.id)
    } finally {
      setDeleting(false)
    }
  }

  async function handleImportToNotebookLM() {
    setImportError(null)
    setImporting(true)
    const notebookTab = window.open('about:blank', '_blank', 'noopener,noreferrer')
    try {
      const result = await createNotebookForVideo(bookmark.title, bookmark.url)
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setImportError(result.error ?? 'Failed to create notebook')
        return
      }
      const updated = await saveBookmarkNotebookUrl(
        bookmark.id,
        result.notebookUrl,
        bookmark.title,
      )
      onNotebookCreated(updated)
      if (notebookTab) {
        notebookTab.location.href = result.notebookUrl
      } else {
        window.open(result.notebookUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      notebookTab?.close()
      setImportError(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card className="entry-card">
      <CardHeader className="gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(bookmark.id, event.target.checked)}
            aria-label={`Select ${bookmark.title}`}
            className={`${checkboxClassName} mt-1.5`}
          />
          <div className="min-w-0 flex-1 space-y-1 text-left">
            <CardTitle className="leading-snug">
              <a
                href={bookmark.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-primary"
                onClick={() => void markViewed()}
              >
                {bookmark.title}
              </a>
            </CardTitle>
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void markViewed()}
            >
              <ExternalLinkIcon className="size-3 shrink-0" />
              <span className="truncate">{bookmark.url}</span>
            </a>
            {bookmark.folder_path ? (
              <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                <FolderIcon className="size-3 shrink-0" />
                <span className="truncate">{bookmark.folder_path}</span>
                <span className="shrink-0">· {bookmark.chrome_profile}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{bookmark.chrome_profile}</p>
            )}
            {bookmark.notebooklm_links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                title={link.title}
              >
                <BookOpenIcon className="size-3 shrink-0" />
                <span className="truncate">{truncateNotebookTitle(link.title)}</span>
              </a>
            ))}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {bookmark.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => void removeTag(tag)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              {!tagInputOpen ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Add tag"
                  onClick={() => setTagInputOpen(true)}
                >
                  <TagPlusIcon className="size-3.5" />
                </Button>
              ) : null}
            </div>
            {tagInputOpen ? (
              <div className="relative pt-1">
                <form className="flex items-center gap-2" onSubmit={(event) => void addTag(event)}>
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    placeholder="Add tag"
                    autoFocus
                    className="h-7 min-w-0 flex-1 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <Button type="submit" variant="outline" size="sm" disabled={!tagDraft.trim()}>
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label="Cancel adding tag"
                    onClick={() => {
                      setTagInputOpen(false)
                      setTagDraft('')
                    }}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </form>
                {availableTags.length > 0 ? (
                  <ul className="absolute left-0 top-full z-10 mt-1 max-h-40 w-full max-w-56 overflow-auto rounded-[min(var(--radius-md),12px)] border border-border bg-popover p-1 shadow-md">
                    {availableTags.map((tag) => (
                      <li key={tag}>
                        <button
                          type="button"
                          className="w-full rounded-sm px-2 py-1 text-left text-xs text-popover-foreground hover:bg-muted"
                          onClick={() => void selectExistingTag(tag)}
                        >
                          {tag}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <CardAction className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className={bookmark.pinned ? 'text-primary' : 'text-muted-foreground'}
            aria-label={bookmark.pinned ? 'Unpin bookmark' : 'Pin bookmark'}
            onClick={() => void togglePinned()}
          >
            <PinIcon className={`size-4 ${bookmark.pinned ? 'fill-current' : ''}`} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {bookmark.notebooklm_links.length === 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={importing}
              onClick={() => void handleImportToNotebookLM()}
            >
              <BookOpenIcon />
              {importing ? 'Creating…' : 'NotebookLM'}
            </Button>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" disabled={deleting} />
              }
            >
              <Trash2Icon />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete bookmark?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes &ldquo;{bookmark.title}&rdquo; from the local bookmarks table.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleDelete()}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {importError ? (
          <p className="text-xs text-destructive">{importError}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Added {formatTimestamp(bookmark.created_at)}
          {bookmark.last_viewed ? (
            <> · Viewed {formatTimestamp(bookmark.last_viewed)}</>
          ) : null}
        </p>
      </CardContent>
    </Card>
  )
})

const SEARCH_THROTTLE_MS = 400

const SEARCH_SCOPES: { value: SearchScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'title', label: 'Titles only' },
  { value: 'tags', label: 'Tags only' },
]

function BookmarkSearch({
  onFilterQueryChange,
  onSearchScopeChange,
  searchScope,
}: {
  onFilterQueryChange: (query: string) => void
  onSearchScopeChange: (scope: SearchScope) => void
  searchScope: SearchScope
}) {
  const [draft, setDraft] = useState('')
  const throttled = useThrottledValue(draft, SEARCH_THROTTLE_MS)

  useEffect(() => {
    onFilterQueryChange(throttled)
  }, [throttled, onFilterQueryChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search bookmarks…"
        className={`${fieldClassName} max-w-sm`}
      />
      <select
        value={searchScope}
        onChange={(event) => onSearchScopeChange(event.target.value as SearchScope)}
        className={selectClassName}
        aria-label="Search scope"
      >
        {SEARCH_SCOPES.map((scope) => (
          <option key={scope.value} value={scope.value}>
            {scope.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export default function BookmarksView() {
  const [sortKey, setSortKey] = useState<SortKey>('created_desc')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [notebookFilter, setNotebookFilter] = useState<NotebookFilter>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [filterQuery, setFilterQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const deferredFilterQuery = useDeferredValue(filterQuery)
  const [pinsAtTop, setPinsAtTop] = useState(readBookmarkPinsAtTop)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [bulkTagOpen, setBulkTagOpen] = useState(false)
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [bulkTagPending, setBulkTagPending] = useState(false)
  const [bulkNotebookExistingOpen, setBulkNotebookExistingOpen] = useState(false)
  const [bulkNotebookPending, setBulkNotebookPending] = useState(false)
  const [bulkNotebookError, setBulkNotebookError] = useState<string | null>(null)
  const [bulkNotebookPickerId, setBulkNotebookPickerId] = useState<number | null>(null)
  const [bulkNotebookOptions, setBulkNotebookOptions] = useState<NotebookRow[]>([])
  const [bulkNotebookOptionsLoading, setBulkNotebookOptionsLoading] = useState(false)
  const [bulkNotebookFilterQuery, setBulkNotebookFilterQuery] = useState('')
  const deferredBulkNotebookFilterQuery = useDeferredValue(bulkNotebookFilterQuery)
  const filteredBulkNotebookOptions = useMemo(
    () => searchNotebooks(bulkNotebookOptions, deferredBulkNotebookFilterQuery),
    [bulkNotebookOptions, deferredBulkNotebookFilterQuery],
  )
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const listFilters = useMemo(() => ({
    sort: sortKey,
    view: viewFilter,
    notebook: notebookFilter,
    tag: tagFilter,
    search: deferredFilterQuery,
    searchScope,
    pinsAtTop,
  }), [
    sortKey,
    viewFilter,
    notebookFilter,
    tagFilter,
    deferredFilterQuery,
    searchScope,
    pinsAtTop,
  ])

  const {
    items: bookmarks,
    tags: allTags,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMoreError,
    loadMore,
    reload,
    replaceItem: replaceBookmark,
    removeItem,
    setError,
  } = useInfiniteList<BookmarkRow>('/api/bookmarks', listFilters)

  useEffect(() => {
    if (tagFilter !== 'all' && !allTags.includes(tagFilter)) {
      setTagFilter('all')
    }
  }, [allTags, tagFilter])

  const selectedCount = selectedIds.size

  const rows = useMemo(
    () =>
      buildPinnedRows(bookmarks, pinsAtTop, { pinned: 'Pinned', rest: 'Bookmarks' }, {
        showStatus: hasMore || loadingMore || Boolean(loadMoreError),
      }),
    [bookmarks, pinsAtTop, hasMore, loadingMore, loadMoreError],
  )

  useEffect(() => {
    const visibleIdSet = new Set(bookmarks.map((bookmark) => bookmark.id))
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIdSet.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [bookmarks])

  useEffect(() => {
    localStorage.setItem(BOOKMARK_PINS_AT_TOP_KEY, String(pinsAtTop))
  }, [pinsAtTop])

  const deleteBookmark = useCallback(async (id: number) => {
    const response = await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error ?? `HTTP ${response.status}`)
    }
    removeItem(id)
  }, [removeItem])

  const toggleSelected = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function selectedBookmarks() {
    return bookmarks.filter((bookmark) => selectedIds.has(bookmark.id))
  }

  const handleTagsChange = useCallback(
    async (bookmark: BookmarkRow, tags: string[]) => {
      const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      })
      if (!response.ok) return
      replaceBookmark((await response.json()) as BookmarkRow)
    },
    [replaceBookmark],
  )

  async function syncFromChrome() {
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      const response = await fetch('/api/bookmarks/sync', { method: 'POST' })
      const payload = await response.json().catch(() => ({})) as {
        error?: string
        inserted?: number
        skipped?: number
        profiles?: string[]
      }
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`)
      }
      await reload()
      setSyncMessage(
        `Synced ${payload.inserted ?? 0} new · ${payload.skipped ?? 0} already present` +
          (payload.profiles?.length ? ` · ${payload.profiles.join(', ')}` : ''),
      )
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError))
    } finally {
      setSyncing(false)
    }
  }

  async function bulkSetPinned(pinned: boolean) {
    const targets = selectedBookmarks().filter((bookmark) => Boolean(bookmark.pinned) !== pinned)
    for (const bookmark of targets) {
      const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      })
      if (!response.ok) continue
      replaceBookmark((await response.json()) as BookmarkRow)
    }
  }

  async function confirmBulkTag(event: FormEvent) {
    event.preventDefault()
    const tag = normalizeTag(bulkTagDraft)
    if (!tag) return
    setBulkTagPending(true)
    try {
      const targets = selectedBookmarks().filter((bookmark) => !bookmark.tags.includes(tag))
      for (const bookmark of targets) {
        const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: [...bookmark.tags, tag] }),
        })
        if (!response.ok) continue
        replaceBookmark((await response.json()) as BookmarkRow)
      }
      setBulkTagOpen(false)
      setBulkTagDraft('')
    } finally {
      setBulkTagPending(false)
    }
  }

  async function confirmBulkDelete() {
    setBulkDeletePending(true)
    setBulkDeleteError(null)
    try {
      for (const bookmark of selectedBookmarks()) {
        await deleteBookmark(bookmark.id)
      }
      clearSelection()
      setBulkDeleteOpen(false)
    } catch (bulkError) {
      setBulkDeleteError(bulkError instanceof Error ? bulkError.message : String(bulkError))
    } finally {
      setBulkDeletePending(false)
    }
  }

  async function linkBookmarksToNotebook(
    rows: BookmarkRow[],
    notebookUrl: string,
    title: string,
  ) {
    for (const bookmark of rows) {
      const updated = await saveBookmarkNotebookUrl(bookmark.id, notebookUrl, title)
      replaceBookmark(updated)
    }
  }

  async function bulkInsertNewNotebook() {
    const rows = selectedBookmarks()
    if (rows.length === 0) return

    setBulkNotebookPending(true)
    setBulkNotebookError(null)
    const notebookTab = window.open('about:blank', '_blank', 'noopener,noreferrer')
    try {
      const urls = rows.map((bookmark) => bookmark.url)
      const title = defaultBulkBookmarkNotebookTitle(rows)
      const result = await bulkCreateNotebookForVideos(title, urls)
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setBulkNotebookError(result.error ?? 'Failed to create notebook')
        return
      }
      await linkBookmarksToNotebook(rows, result.notebookUrl, title)
      clearSelection()
      if (notebookTab) {
        notebookTab.location.href = result.notebookUrl
      } else {
        window.open(result.notebookUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (bulkError) {
      notebookTab?.close()
      setBulkNotebookError(bulkError instanceof Error ? bulkError.message : String(bulkError))
    } finally {
      setBulkNotebookPending(false)
    }
  }

  async function openBulkNotebookExistingModal() {
    setBulkNotebookError(null)
    setBulkNotebookPickerId(null)
    setBulkNotebookFilterQuery('')
    setBulkNotebookExistingOpen(true)
    setBulkNotebookOptionsLoading(true)
    try {
      const notebooks = await fetchNotebooks()
      const sorted = sortNotebooks(notebooks, 'created_desc')
      setBulkNotebookOptions(sorted)
      if (sorted.length === 1) {
        setBulkNotebookPickerId(sorted[0].id)
      }
    } catch (loadError) {
      setBulkNotebookError(loadError instanceof Error ? loadError.message : String(loadError))
      setBulkNotebookOptions([])
    } finally {
      setBulkNotebookOptionsLoading(false)
    }
  }

  async function confirmBulkAddToExistingNotebook() {
    const rows = selectedBookmarks()
    const notebook = bulkNotebookOptions.find((row) => row.id === bulkNotebookPickerId)
    if (rows.length === 0 || !notebook) return

    setBulkNotebookPending(true)
    setBulkNotebookError(null)
    const notebookTab = window.open(notebook.url, '_blank', 'noopener,noreferrer')
    try {
      const result = await addVideosToNotebook(
        notebook.notebooklm_id,
        rows.map((bookmark) => bookmark.url),
      )
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setBulkNotebookError(result.error ?? 'Failed to add sources')
        return
      }
      await linkBookmarksToNotebook(rows, result.notebookUrl, notebook.title)
      clearSelection()
      setBulkNotebookExistingOpen(false)
      setBulkNotebookPickerId(null)
    } catch (bulkError) {
      notebookTab?.close()
      setBulkNotebookError(bulkError instanceof Error ? bulkError.message : String(bulkError))
    } finally {
      setBulkNotebookPending(false)
    }
  }

  function renderBookmark(bookmark: BookmarkRow) {
    return (
      <BookmarkCard
        key={bookmark.id}
        bookmark={bookmark}
        selected={selectedIds.has(bookmark.id)}
        onSelectedChange={toggleSelected}
        onDelete={deleteBookmark}
        onNotebookCreated={replaceBookmark}
        onViewed={replaceBookmark}
        onPinned={replaceBookmark}
        onTagsChange={handleTagsChange}
        allTags={allTags}
      />
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BookmarkSearch
            onFilterQueryChange={setFilterQuery}
            onSearchScopeChange={setSearchScope}
            searchScope={searchScope}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => void syncFromChrome()}
          >
            <RefreshCwIcon className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Chrome'}
          </Button>
        </div>
        {syncMessage ? (
          <p className="text-sm text-muted-foreground">{syncMessage}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading bookmarks…' : `${total} bookmarks`}
            </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={pinsAtTop}
                onChange={(event) => setPinsAtTop(event.target.checked)}
                className="size-3.5 rounded border-border accent-primary"
              />
              Pinned section
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Tag
              <select
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                className={selectClassName}
              >
                <option value="all">All</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Viewed
              <select
                value={viewFilter}
                onChange={(event) => setViewFilter(event.target.value as ViewFilter)}
                className={selectClassName}
              >
                <option value="all">All</option>
                <option value="never_viewed">Never viewed</option>
                <option value="viewed">Viewed</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Notebook
              <select
                value={notebookFilter}
                onChange={(event) =>
                  setNotebookFilter(event.target.value as NotebookFilter)
                }
                className={selectClassName}
              >
                <option value="all">All</option>
                <option value="with_notebook">With notebook</option>
                <option value="without_notebook">Without notebook</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Sort by
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className={selectClassName}
              >
                <option value="created_desc">Date added (newest)</option>
                <option value="created_asc">Date added (oldest)</option>
                <option value="viewed_desc">Last viewed (recent)</option>
                <option value="viewed_asc">Last viewed (oldest)</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
          <Button variant="outline" size="sm" onClick={() => void bulkSetPinned(true)}>
            <PinIcon className="size-3.5" />
            Pin
          </Button>
          <Button variant="outline" size="sm" onClick={() => void bulkSetPinned(false)}>
            <PinIcon className="size-3.5" />
            Unpin
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkTagOpen(true)}>
            <TagPlusIcon className="size-3.5" />
            Tag
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkNotebookPending}
            onClick={() => void bulkInsertNewNotebook()}
          >
            <BookOpenIcon className="size-3.5" />
            Bulk insert to new notebook
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkNotebookPending}
            onClick={() => void openBulkNotebookExistingModal()}
          >
            <BookOpenIcon className="size-3.5" />
            Bulk add to existing notebook
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setBulkDeleteError(null)
              setBulkDeleteOpen(true)
            }}
          >
            <Trash2Icon className="size-3.5" />
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
          {bulkNotebookError && !bulkNotebookExistingOpen ? (
            <p className="w-full text-sm text-destructive">{bulkNotebookError}</p>
          ) : null}
        </div>
      ) : null}

      {!loading && bookmarks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? 'No bookmarks yet. Sync from Chrome to import.'
            : 'No bookmarks match.'}
        </p>
      ) : null}

      {bookmarks.length > 0 || loadingMore || loadMoreError ? (
        <VirtualizedList
          rows={rows}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          estimateSize={(row) => {
            if (row.type === 'header') return 28
            if (row.type === 'status') return 48
            return 160
          }}
          renderRow={(row) => {
            if (row.type === 'header') {
              return (
                <h2 className="text-sm font-medium text-muted-foreground">
                  {row.label}
                </h2>
              )
            }
            if (row.type === 'status') {
              return (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  {loadMoreError ? (
                    <>
                      <span>{loadMoreError}</span>
                      <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                        Retry
                      </Button>
                    </>
                  ) : loadingMore || hasMore ? (
                    <span>Loading more…</span>
                  ) : null}
                </div>
              )
            }
            return renderBookmark(bookmarks[row.index])
          }}
        />
      ) : null}

      <Dialog open={bulkTagOpen} onOpenChange={setBulkTagOpen}>
        <DialogContent>
          <form onSubmit={(event) => void confirmBulkTag(event)}>
            <DialogHeader>
              <DialogTitle>Add tag to {selectedCount} bookmarks</DialogTitle>
              <DialogDescription>
                Adds the tag to each selected bookmark that does not already have it.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <input
                value={bulkTagDraft}
                onChange={(event) => setBulkTagDraft(event.target.value)}
                placeholder="Tag name"
                className={fieldClassName}
                autoFocus
              />
            </div>
            <DialogFooter>
              <DialogClose type="button" disabled={bulkTagPending}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={bulkTagPending || !bulkTagDraft.trim()}>
                {bulkTagPending ? 'Adding…' : 'Add tag'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkNotebookExistingOpen}
        onOpenChange={(open) => {
          setBulkNotebookExistingOpen(open)
          if (!open) {
            setBulkNotebookPickerId(null)
            setBulkNotebookFilterQuery('')
            setBulkNotebookError(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add {selectedCount} bookmarks to notebook</DialogTitle>
            <DialogDescription>
              Choose an existing NotebookLM notebook. Selected URLs are added as sources.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <input
              type="search"
              value={bulkNotebookFilterQuery}
              onChange={(event) => setBulkNotebookFilterQuery(event.target.value)}
              placeholder="Search notebooks…"
              aria-label="Search notebooks"
              className={fieldClassName}
              disabled={bulkNotebookOptionsLoading || bulkNotebookOptions.length === 0}
              autoFocus
            />
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {bulkNotebookOptionsLoading ? (
                <p className="text-sm text-muted-foreground">Loading notebooks…</p>
              ) : bulkNotebookOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notebooks in the local cache. Sync from Library first.
                </p>
              ) : filteredBulkNotebookOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notebooks match.</p>
              ) : (
                filteredBulkNotebookOptions.map((notebook) => (
                  <label
                    key={notebook.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
                  >
                    <input
                      type="radio"
                      name="bulk-bookmark-notebook-target"
                      checked={bulkNotebookPickerId === notebook.id}
                      onChange={() => setBulkNotebookPickerId(notebook.id)}
                      className={`${checkboxClassName} mt-1`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{notebook.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {notebook.source_count}{' '}
                        {notebook.source_count === 1 ? 'source' : 'sources'}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          {bulkNotebookError ? (
            <p className="text-sm text-destructive">{bulkNotebookError}</p>
          ) : null}
          <DialogFooter>
            <DialogClose type="button" disabled={bulkNotebookPending}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              disabled={
                bulkNotebookPending ||
                bulkNotebookOptionsLoading ||
                bulkNotebookPickerId == null
              }
              onClick={() => void confirmBulkAddToExistingNotebook()}
            >
              {bulkNotebookPending ? 'Adding…' : 'Add to notebook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} bookmarks?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected bookmarks from the local table.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {bulkDeleteError ? (
            <p className="text-sm text-destructive">{bulkDeleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeletePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkDeletePending}
              onClick={() => void confirmBulkDelete()}
            >
              {bulkDeletePending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
