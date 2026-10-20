import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MergeIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  TagPlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useNotebooks } from '@/hooks/useNotebooks'
import { useTabSelection } from '@/hooks/useTabSelection'
import { useInfiniteList } from '@/hooks/useInfiniteList'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import {
  buildPinnedRows,
  VirtualizedList,
} from '@/components/VirtualizedList'
import {
  formatTimestamp,
  PINS_AT_TOP_KEY,
  readPinsAtTop,
  selectClassName,
  type SearchScope,
  type SortKey,
  type ViewFilter,
} from '@/lib/notebook-list'
import { normalizeTag } from '@/lib/tags'
import { cn } from '@/lib/utils'
import type { MergeSourcePreview, NotebookMergeReport } from '@/api/notebooks'
import type { NotebookRow } from '@/types'

const fieldClassName =
  'h-8 w-full rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const checkboxClassName = 'size-3.5 shrink-0 rounded border-border accent-primary'

const NOTEBOOK_SOURCE_CAP = 50

// ponytail: floor so sub-second API syncs still show loading motion; upgrade = drop if latency rises
const SYNC_MIN_ACTIVE_MS = 1000
const SYNC_SUCCESS_MS = 1800

type SyncVisual = 'idle' | 'syncing' | 'success'

function NotebookCardSkeleton({ index }: { index: number }) {
  return (
    <article
      className="rounded-lg border border-border bg-card p-4"
      style={{ '--sync-i': index } as CSSProperties}
      aria-hidden
    >
      <div className="flex items-start gap-3">
        <div className="sync-skeleton-shine mt-1.5 size-3.5 shrink-0 rounded" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="sync-skeleton-shine h-4 w-2/5 max-w-48 rounded" />
            <div className="sync-skeleton-shine h-5 w-16 rounded-full" />
          </div>
          <div className="sync-skeleton-shine h-3 w-3/4 max-w-xs rounded" />
          <div className="flex gap-1.5">
            <div className="sync-skeleton-shine h-5 w-12 rounded-full" />
            <div className="sync-skeleton-shine h-5 w-14 rounded-full" />
          </div>
          <div className="sync-skeleton-shine h-3 w-1/3 max-w-40 rounded" />
        </div>
        <div className="flex gap-0.5">
          <div className="sync-skeleton-shine size-7 rounded-lg" />
          <div className="sync-skeleton-shine size-7 rounded-lg" />
        </div>
      </div>
    </article>
  )
}

function SyncStatusDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      <span className="sync-dot size-1 rounded-full bg-current" />
      <span className="sync-dot size-1 rounded-full bg-current" />
      <span className="sync-dot size-1 rounded-full bg-current" />
    </span>
  )
}

function NotebookSelectCheckbox({
  selected,
  onSelectedChange,
  ariaLabel,
  className,
}: {
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  ariaLabel: string
  className: string
}) {
  const [checked, setChecked] = useState(selected)

  useEffect(() => {
    setChecked(selected)
  }, [selected])

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => {
        const next = event.target.checked
        setChecked(next)
        onSelectedChange(next)
      }}
      aria-label={ariaLabel}
      className={className}
    />
  )
}

const NotebookCard = memo(function NotebookCard({
  notebook,
  selected,
  onToggleSelect,
  onPinned,
  onTagsChange,
  onRename,
  onDelete,
}: {
  notebook: NotebookRow
  selected: boolean
  onToggleSelect: (id: number, checked: boolean) => void
  onPinned: (notebook: NotebookRow) => void
  onTagsChange: (notebook: NotebookRow, tags: string[]) => Promise<void>
  onRename: (notebook: NotebookRow, title: string) => Promise<void>
  onDelete: (notebook: NotebookRow) => Promise<void>
}) {
  const [tagDraft, setTagDraft] = useState('')
  const [tagInputOpen, setTagInputOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState(notebook.title)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [renamePending, setRenamePending] = useState(false)
  const [deletePending, setDeletePending] = useState(false)

  useEffect(() => {
    if (renameOpen) {
      setRenameDraft(notebook.title)
      setRenameError(null)
    }
  }, [renameOpen, notebook.title])

  useEffect(() => {
    if (deleteOpen) setDeleteError(null)
  }, [deleteOpen])

  async function togglePinned() {
    try {
      await onPinned(notebook)
    } catch {
      // fire-and-forget
    }
  }

  async function addTag(event: FormEvent) {
    event.preventDefault()
    const tag = normalizeTag(tagDraft)
    if (!tag || notebook.tags.includes(tag)) {
      setTagDraft('')
      return
    }
    await onTagsChange(notebook, [...notebook.tags, tag])
    setTagDraft('')
    setTagInputOpen(false)
  }

  async function removeTag(tag: string) {
    await onTagsChange(notebook, notebook.tags.filter((value) => value !== tag))
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault()
    const title = renameDraft.trim()
    if (!title) {
      setRenameError('Title is required')
      return
    }
    if (title === notebook.title) {
      setRenameOpen(false)
      return
    }
    setRenamePending(true)
    setRenameError(null)
    try {
      await onRename(notebook, title)
      setRenameOpen(false)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error))
    } finally {
      setRenamePending(false)
    }
  }

  async function confirmDelete() {
    setDeletePending(true)
    setDeleteError(null)
    try {
      await onDelete(notebook)
      setDeleteOpen(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <>
      <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <NotebookSelectCheckbox
          selected={selected}
          onSelectedChange={(checked) => onToggleSelect(notebook.id, checked)}
          ariaLabel={`Select ${notebook.title}`}
          className={`${checkboxClassName} mt-1.5`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={notebook.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium leading-snug hover:text-primary"
            >
              {notebook.title}
            </a>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {notebook.source_count} {notebook.source_count === 1 ? 'source' : 'sources'}
            </span>
          </div>
          <a
            href={notebook.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3 shrink-0" />
            <span className="truncate">{notebook.url}</span>
          </a>
          <div className="flex flex-wrap items-center gap-1.5">
            {notebook.tags.map((tag) => (
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
          ) : null}
          <p className="text-xs text-muted-foreground">
            Added {formatTimestamp(notebook.created_at)}
            {notebook.last_viewed ? (
              <> · Viewed {formatTimestamp(notebook.last_viewed)}</>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Rename ${notebook.title}`}
            onClick={() => setRenameOpen(true)}
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${notebook.title}`}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={notebook.pinned ? 'text-primary' : 'text-muted-foreground'}
            aria-label={notebook.pinned ? 'Unpin notebook' : 'Pin notebook'}
            onClick={() => void togglePinned()}
          >
            <PinIcon className={`size-4 ${notebook.pinned ? 'fill-current' : ''}`} />
          </Button>
        </div>
      </div>
    </article>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submitRename(event)}>
            <DialogHeader>
              <DialogTitle>Rename notebook</DialogTitle>
              <DialogDescription>
                Updates the title in NotebookLM and your local cache.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <input
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                className={fieldClassName}
                autoFocus
              />
              {renameError ? (
                <p className="mt-2 text-sm text-destructive">{renameError}</p>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose type="button" disabled={renamePending}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={renamePending || !renameDraft.trim()}>
                {renamePending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{notebook.title}</strong> from NotebookLM
              and removes it from your local cache. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deletePending}
              onClick={() => void confirmDelete()}
            >
              {deletePending ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

const SEARCH_THROTTLE_MS = 400

const SEARCH_SCOPES: { value: SearchScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'title', label: 'Titles only' },
  { value: 'tags', label: 'Tags only' },
]

function NotebookSearch({
  onFilterQueryChange,
  onSearchScopeChange,
  searchScope,
}: {
  onFilterQueryChange: (query: string) => void
  onSearchScopeChange: (scope: SearchScope) => void
  searchScope: SearchScope
}) {
  const [query, setQuery] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const filterQuery = useThrottledValue(query, SEARCH_THROTTLE_MS)

  useEffect(() => {
    onFilterQueryChange(filterQuery)
  }, [filterQuery, onFilterQueryChange])

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notebooks…"
          aria-label="Search notebooks"
          className={`${fieldClassName} min-w-0 flex-1`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced
        </Button>
      </div>
      {advancedOpen ? (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <legend className="sr-only">Search scope</legend>
          {SEARCH_SCOPES.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="search-scope"
                value={value}
                checked={searchScope === value}
                onChange={() => onSearchScopeChange(value)}
                className={checkboxClassName}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  )
}

function TagAccordion({
  tags,
  selectedTag,
  onSelectTag,
}: {
  tags: string[]
  selectedTag: string
  onSelectTag: (tag: string) => void
}) {
  return (
    <details className="group rounded-[min(var(--radius-md),12px)] border border-border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span>
          All tags
          <span className="ml-1.5 text-xs">({tags.length})</span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      {tags.length === 0 ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          No tags yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => onSelectTag('all')}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              selectedTag === 'all'
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onSelectTag(tag)}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                selectedTag === tag
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </details>
  )
}

export default function LibraryView() {
  const { sync, createNotebook, updateNotebook, renameNotebook, deleteNotebook, mergeNotebooks, previewMergeSources } = useNotebooks()
  const [sortKey, setSortKey] = useState<SortKey>('created_desc')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [filterQuery, setFilterQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const deferredFilterQuery = useDeferredValue(filterQuery)
  const [pinsAtTop, setPinsAtTop] = useState(readPinsAtTop)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [bulkTagOpen, setBulkTagOpen] = useState(false)
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [bulkTagPending, setBulkTagPending] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSelection, setMergeSelection] = useState<NotebookRow[]>([])
  const [mergeDestinationId, setMergeDestinationId] = useState<number | null>(null)
  const [mergeMode, setMergeMode] = useState<'existing' | 'new'>('existing')
  const [mergeTitle, setMergeTitle] = useState('')
  const [mergePending, setMergePending] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [mergeReport, setMergeReport] = useState<NotebookMergeReport | null>(null)
  const [mergeChoices, setMergeChoices] = useState<MergeSourcePreview | null>(null)
  const [mergeChoicesLoading, setMergeChoicesLoading] = useState(false)
  const [mergeChoicesError, setMergeChoicesError] = useState<string | null>(null)
  const [includedSourceKeys, setIncludedSourceKeys] = useState<Set<string>>(() => new Set())
  const mergeListedSources = useMemo(
    () => mergeSelection.reduce((sum, notebook) => sum + notebook.source_count, 0),
    [mergeSelection],
  )
  const mergeOverCap = mergeListedSources > NOTEBOOK_SOURCE_CAP
  const mergeCap = mergeChoices?.cap ?? NOTEBOOK_SOURCE_CAP
  const mergeSelectedUrls = useMemo(() => {
    if (!mergeChoices) return null
    return mergeChoices.choices.flatMap((choice) =>
      choice.role === 'add' && choice.url && includedSourceKeys.has(choice.key) ? [choice.url] : [],
    )
  }, [mergeChoices, includedSourceKeys])
  const mergeProjectedSources = mergeChoices
    ? mergeChoices.destinationSourceCount + (mergeSelectedUrls?.length ?? 0)
    : mergeListedSources
  const mergeSelectionOverCap = mergeProjectedSources > mergeCap
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [syncVisual, setSyncVisual] = useState<SyncVisual>('idle')
  const syncStartedAtRef = useRef(0)
  const syncVisualTimerRef = useRef<number | null>(null)

  const listFilters = useMemo(() => ({
    sort: sortKey,
    view: viewFilter,
    notebook: 'all' as const,
    tag: tagFilter,
    search: deferredFilterQuery,
    searchScope,
    pinsAtTop,
  }), [sortKey, viewFilter, tagFilter, deferredFilterQuery, searchScope, pinsAtTop])

  const {
    items: notebooks,
    tags: allTags,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMoreError,
    loadMore,
    reload,
    replaceItem,
    removeItem,
  } = useInfiniteList<NotebookRow>('/api/notebooks', listFilters)

  const { selectedIds, toggleSelected, clearSelection, rememberSelection } = useTabSelection(
    'notebooks',
    notebooks,
    loading,
  )

  const [syncPending, setSyncPending] = useState(false)
  const isSyncing = syncPending
  const isInitialLoad = loading && !syncPending
  const isBusy = isSyncing || isInitialLoad
  const syncActive = syncVisual === 'syncing'
  const syncSuccess = syncVisual === 'success'

  function clearSyncVisualTimer() {
    if (syncVisualTimerRef.current !== null) {
      window.clearTimeout(syncVisualTimerRef.current)
      syncVisualTimerRef.current = null
    }
  }

  useEffect(() => () => clearSyncVisualTimer(), [])

  useEffect(() => {
    localStorage.setItem(PINS_AT_TOP_KEY, String(pinsAtTop))
  }, [pinsAtTop])

  useEffect(() => {
    if (tagFilter !== 'all' && !allTags.includes(tagFilter)) {
      setTagFilter('all')
    }
  }, [allTags, tagFilter])

  const rows = useMemo(
    () =>
      buildPinnedRows(notebooks, pinsAtTop, { pinned: 'Pinned', rest: 'Notebooks' }, {
        showStatus: hasMore || loadingMore || Boolean(loadMoreError),
      }),
    [notebooks, pinsAtTop, hasMore, loadingMore, loadMoreError],
  )

  const selectedCount = selectedIds.size

  function selectedNotebooks() {
    return notebooks.filter((n) => selectedIds.has(n.id))
  }

  const handleSync = async () => {
    clearSyncVisualTimer()
    syncStartedAtRef.current = Date.now()
    setSyncVisual('syncing')
    setSyncPending(true)
    try {
      await sync()
      await reload()
      const remaining = Math.max(0, SYNC_MIN_ACTIVE_MS - (Date.now() - syncStartedAtRef.current))
      syncVisualTimerRef.current = window.setTimeout(() => {
        setSyncVisual('success')
        syncVisualTimerRef.current = window.setTimeout(() => {
          setSyncVisual('idle')
          syncVisualTimerRef.current = null
        }, SYNC_SUCCESS_MS)
      }, remaining)
    } catch {
      clearSyncVisualTimer()
      setSyncVisual('idle')
    } finally {
      setSyncPending(false)
    }
  }

  const handleCreate = async () => {
    setCreatePending(true)
    setCreateError(null)
    try {
      const { notebook } = await createNotebook()
      await reload()
      window.open(`${notebook.url}?addSource=true`, '_blank', 'noopener,noreferrer')
    } catch (createErr) {
      setCreateError(createErr instanceof Error ? createErr.message : String(createErr))
    } finally {
      setCreatePending(false)
    }
  }

  async function handleRename(notebook: NotebookRow, title: string) {
    const updated = await renameNotebook(notebook.id, notebook.notebooklm_id, title)
    replaceItem(updated)
  }

  async function handleDelete(notebook: NotebookRow) {
    await deleteNotebook(notebook.id, notebook.notebooklm_id)
    removeItem(notebook.id)
  }

  async function handlePinned(notebook: NotebookRow) {
    const updated = await updateNotebook(notebook.id, { pinned: !notebook.pinned })
    replaceItem(updated)
  }

  async function handleTagsChange(notebook: NotebookRow, tags: string[]) {
    const updated = await updateNotebook(notebook.id, { tags })
    replaceItem(updated)
  }

  const cardActionsRef = useRef({
    onPinned: handlePinned,
    onTagsChange: handleTagsChange,
    onRename: handleRename,
    onDelete: handleDelete,
  })
  cardActionsRef.current = {
    onPinned: handlePinned,
    onTagsChange: handleTagsChange,
    onRename: handleRename,
    onDelete: handleDelete,
  }

  const onCardPinned = useCallback((notebook: NotebookRow) => {
    void cardActionsRef.current.onPinned(notebook)
  }, [])

  const onCardTagsChange = useCallback((notebook: NotebookRow, tags: string[]) => {
    return cardActionsRef.current.onTagsChange(notebook, tags)
  }, [])

  const onCardRename = useCallback((notebook: NotebookRow, title: string) => {
    return cardActionsRef.current.onRename(notebook, title)
  }, [])

  const onCardDelete = useCallback((notebook: NotebookRow) => {
    return cardActionsRef.current.onDelete(notebook)
  }, [])

  async function bulkSetPinned(pinned: boolean) {
    const targets = selectedNotebooks().filter((n) => Boolean(n.pinned) !== pinned)
    for (const notebook of targets) {
      const updated = await updateNotebook(notebook.id, { pinned })
      replaceItem(updated)
    }
  }

  async function confirmBulkTag(event: FormEvent) {
    event.preventDefault()
    const tag = normalizeTag(bulkTagDraft)
    if (!tag) return
    setBulkTagPending(true)
    try {
      const targets = selectedNotebooks().filter((n) => !n.tags.includes(tag))
      for (const notebook of targets) {
        const updated = await updateNotebook(notebook.id, { tags: [...notebook.tags, tag] })
        replaceItem(updated)
      }
      setBulkTagOpen(false)
      setBulkTagDraft('')
    } finally {
      setBulkTagPending(false)
    }
  }

  function openMerge() {
    const selected = selectedNotebooks()
    if (selected.length < 2) return
    const destination = selected.reduce((best, notebook) =>
      notebook.source_count > best.source_count ? notebook : best,
    )
    setMergeSelection(selected)
    setMergeDestinationId(destination.id)
    setMergeMode('existing')
    setMergeTitle('')
    setMergeError(null)
    setMergeReport(null)
    setMergeChoices(null)
    setMergeChoicesError(null)
    setIncludedSourceKeys(new Set())
    setMergeOpen(true)
  }

  useEffect(() => {
    if (!mergeOpen || !mergeOverCap || mergeReport) return
    const destinationId = mergeMode === 'existing'
      ? mergeSelection.find((notebook) => notebook.id === mergeDestinationId)?.notebooklm_id
      : undefined
    let cancelled = false
    setMergeChoices(null)
    setIncludedSourceKeys(new Set())
    setMergeChoicesLoading(true)
    setMergeChoicesError(null)
    void previewMergeSources({
      sourceNotebooklmIds: mergeSelection.map((notebook) => notebook.notebooklm_id),
      destinationNotebooklmId: destinationId,
    }).then((preview) => {
      if (cancelled) return
      setMergeChoices(preview)
      setIncludedSourceKeys(new Set(
        preview.choices.flatMap((choice) => choice.role === 'add' ? [choice.key] : []),
      ))
    }).catch((error: unknown) => {
      if (cancelled) return
      setMergeChoices(null)
      setMergeChoicesError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!cancelled) setMergeChoicesLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [
    mergeOpen,
    mergeOverCap,
    mergeReport,
    mergeMode,
    mergeDestinationId,
    mergeSelection,
    previewMergeSources,
  ])

  function toggleMergeSource(key: string) {
    setIncludedSourceKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function mergeChoiceNote(role: MergeSourcePreview['choices'][number]['role']) {
    if (role === 'destination') return 'already on destination'
    if (role === 'duplicate') return 'duplicate'
    if (role === 'no-url') return 'no URL to copy'
    return null
  }

  async function confirmMerge(event: FormEvent) {
    event.preventDefault()
    if (mergeSelection.length < 2) return
    const destination = mergeMode === 'existing'
      ? mergeSelection.find((notebook) => notebook.id === mergeDestinationId)
      : null
    if (mergeMode === 'existing' && !destination) {
      setMergeError('Choose a destination notebook')
      return
    }
    if (mergeMode === 'new' && !mergeTitle.trim()) return
    setMergePending(true)
    setMergeError(null)
    try {
      const report = await mergeNotebooks({
        sourceNotebooklmIds: mergeSelection.map((notebook) => notebook.notebooklm_id),
        destinationNotebooklmId: destination?.notebooklm_id,
        title: mergeMode === 'new' ? mergeTitle.trim() : undefined,
        urls: mergeSelectedUrls ?? undefined,
      })
      setMergeReport(report)
      if (mergeOverCap) rememberSelection()
      else clearSelection()
      await reload()
    } catch (mergeErr) {
      setMergeError(mergeErr instanceof Error ? mergeErr.message : String(mergeErr))
      await reload()
    } finally {
      setMergePending(false)
    }
  }

  function skipReasonLabel(reason: 'no-url' | 'duplicate') {
    if (reason === 'duplicate') return 'duplicate URL'
    return 'no URL to copy'
  }

  async function confirmBulkDelete() {
    setBulkDeletePending(true)
    setBulkDeleteError(null)
    try {
      for (const notebook of selectedNotebooks()) {
        await deleteNotebook(notebook.id, notebook.notebooklm_id)
        removeItem(notebook.id)
      }
      clearSelection()
      setBulkDeleteOpen(false)
    } catch (bulkError) {
      setBulkDeleteError(bulkError instanceof Error ? bulkError.message : String(bulkError))
    } finally {
      setBulkDeletePending(false)
    }
  }

  function renderNotebook(notebook: NotebookRow, index: number) {
    return (
      <div
        key={notebook.id}
        className={cn(syncSuccess && 'sync-card-reveal')}
        style={
          syncSuccess
            ? ({ '--sync-i': Math.min(index, 10) } as CSSProperties)
            : undefined
        }
      >
        <NotebookCard
          notebook={notebook}
          selected={selectedIds.has(notebook.id)}
          onToggleSelect={toggleSelected}
          onPinned={onCardPinned}
          onTagsChange={onCardTagsChange}
          onRename={onCardRename}
          onDelete={onCardDelete}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sync uses a Playwright profile for NotebookLM auth (YT_PROFILE_DIR).
            If sync fails, a login browser opens automatically, or run <code>npm run login</code>.
          </p>
          <NotebookSearch
            onFilterQueryChange={setFilterQuery}
            onSearchScopeChange={setSearchScope}
            searchScope={searchScope}
          />
          <TagAccordion
            tags={allTags}
            selectedTag={tagFilter}
            onSelectTag={setTagFilter}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isInitialLoad ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  Loading notebooks
                  <SyncStatusDots />
                </span>
              ) : syncActive ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="sync-spinner size-3.5" aria-hidden />
                  Syncing from NotebookLM
                  <SyncStatusDots />
                </span>
              ) : syncSuccess ? (
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <CheckIcon className="sync-check-pop size-3.5 text-primary" aria-hidden />
                  Updated
                </span>
              ) : (
                `${total} notebooks`
              )}
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
                  onChange={(event) =>
                    setViewFilter(event.target.value as ViewFilter)
                  }
                  className={selectClassName}
                >
                  <option value="all">All</option>
                  <option value="never_viewed">Never viewed</option>
                  <option value="viewed">Viewed</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort by
                <select
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(event.target.value as SortKey)
                  }
                  className={selectClassName}
                >
                  <option value="created_desc">Date added (newest)</option>
                  <option value="created_asc">Date added (oldest)</option>
                  <option value="viewed_desc">Last viewed (recent)</option>
                  <option value="viewed_asc">Last viewed (oldest)</option>
                  <option value="sources_desc">Sources (most)</option>
                  <option value="sources_asc">Sources (fewest)</option>
                </select>
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void handleCreate()}
              disabled={createPending || isBusy}
            >
              <PlusIcon className="size-4" />
              {createPending ? 'Creating notebook…' : 'Create new notebook'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleSync()}
              disabled={syncActive || isBusy}
              aria-busy={syncActive}
              className={cn(
                syncActive && 'sync-btn-active',
                syncSuccess && 'sync-btn-success',
              )}
            >
              {syncActive ? (
                <Loader2Icon className="sync-spinner size-4" aria-hidden />
              ) : syncSuccess ? (
                <CheckIcon className="sync-check-pop size-4 text-primary" aria-hidden />
              ) : null}
              {syncActive ? 'Syncing notebooks…' : syncSuccess ? 'Synced' : 'Sync from NotebookLM'}
            </Button>
          </div>
          {createError ? (
            <p className="text-sm text-destructive">{createError}</p>
          ) : null}
        </header>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
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
            {selectedCount >= 2 ? (
              <Button variant="outline" size="sm" onClick={openMerge}>
                <MergeIcon className="size-3.5" />
                Merge
              </Button>
            ) : null}
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
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <div
            className={cn(
              'flex flex-col gap-4 sync-list-refresh',
              syncActive && notebooks.length > 0 && 'pointer-events-none opacity-45 saturate-50',
            )}
            aria-busy={syncActive}
          >
            {(isBusy || syncActive) && notebooks.length === 0 ? (
              <>
                <NotebookCardSkeleton index={0} />
                <NotebookCardSkeleton index={1} />
                <NotebookCardSkeleton index={2} />
              </>
            ) : null}
            {!loading && notebooks.length === 0 && !syncActive ? (
              <p className="text-sm text-muted-foreground">
                {total === 0
                  ? 'No notebooks in cache yet. Sync from NotebookLM to get started.'
                  : 'No notebooks match.'}
              </p>
            ) : null}
            {notebooks.length > 0 || loadingMore || loadMoreError ? (
              <VirtualizedList
                rows={rows}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={() => void loadMore()}
                estimateSize={(row) => {
                  if (row.type === 'header') return 28
                  if (row.type === 'status') return 48
                  return 140
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
                  return renderNotebook(notebooks[row.index], row.index)
                }}
              />
            ) : null}
          </div>
        </div>

        <Dialog open={bulkTagOpen} onOpenChange={setBulkTagOpen}>
          <DialogContent>
            <form onSubmit={(event) => void confirmBulkTag(event)}>
              <DialogHeader>
                <DialogTitle>Add tag to {selectedCount} notebooks</DialogTitle>
                <DialogDescription>
                  Adds the tag to each selected notebook that does not already have it.
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
          open={mergeOpen}
          onOpenChange={(open) => {
            setMergeOpen(open)
            if (!open) {
              setMergeError(null)
              setMergeReport(null)
              if (mergeOverCap) rememberSelection()
            }
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
            {mergeReport ? (
              <>
                <DialogHeader>
                  <DialogTitle>Merged into {mergeReport.destinationTitle}</DialogTitle>
                  <DialogDescription>
                    Added {mergeReport.addedCount}{' '}
                    {mergeReport.addedCount === 1 ? 'source' : 'sources'}. The destination now has{' '}
                    {mergeReport.sourceCount}{' '}
                    {mergeReport.sourceCount === 1 ? 'source' : 'sources'}. The other notebooks were left in place.
                  </DialogDescription>
                </DialogHeader>
                {mergeReport.skipped.length > 0 ? (
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto py-2 text-sm">
                    <p className="text-muted-foreground">Skipped {mergeReport.skipped.length}</p>
                    {mergeReport.skipped.map((source, index) => (
                      <p key={`${source.reason}-${index}`}>
                        {source.title ?? 'Untitled source'} - {skipReasonLabel(source.reason)}
                      </p>
                    ))}
                  </div>
                ) : null}
                <DialogFooter>
                  <DialogClose type="button">Close</DialogClose>
                </DialogFooter>
              </>
            ) : (
              <form onSubmit={(event) => void confirmMerge(event)}>
                <DialogHeader>
                  <DialogTitle>Merge {mergeSelection.length} notebooks</DialogTitle>
                  <DialogDescription>
                    Copies web and YouTube sources into one notebook. Pasted text, uploads, and Drive files without a URL are skipped. Matching URLs already on the destination are skipped. A standard NotebookLM notebook holds 50 sources, and the merge stops if that cap would be exceeded. The other notebooks stay as they are.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-2">
                  {mergeSelection.map((notebook) => (
                    <label
                      key={notebook.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
                    >
                      <input
                        type="radio"
                        name="merge-destination"
                        checked={mergeMode === 'existing' && mergeDestinationId === notebook.id}
                        onChange={() => {
                          setMergeMode('existing')
                          setMergeDestinationId(notebook.id)
                        }}
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
                  ))}
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60">
                    <input
                      type="radio"
                      name="merge-destination"
                      checked={mergeMode === 'new'}
                      onChange={() => setMergeMode('new')}
                      className={`${checkboxClassName} mt-1`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">New notebook</span>
                      {mergeMode === 'new' ? (
                        <input
                          value={mergeTitle}
                          onChange={(event) => setMergeTitle(event.target.value)}
                          placeholder="Merged notebook"
                          aria-label="New notebook title"
                          className={`${fieldClassName} mt-2`}
                          autoFocus
                        />
                      ) : null}
                    </span>
                  </label>
                </div>
                {mergeError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{mergeError}</AlertDescription>
                  </Alert>
                ) : null}
                {mergeOverCap ? (
                  <div className="space-y-2">
                    <Alert variant={mergeSelectionOverCap ? 'destructive' : 'default'}>
                      <AlertDescription>
                        {mergeChoices
                          ? `This merge would put ${mergeProjectedSources} sources on the destination. A standard notebook holds ${mergeCap}.`
                          : `These notebooks list ${mergeListedSources} sources. A standard notebook holds ${mergeCap}.`}
                        {mergeSelectionOverCap ? ' Uncheck sources to get under that cap.' : null}
                      </AlertDescription>
                    </Alert>
                    {mergeChoicesLoading ? (
                      <p className="text-sm text-muted-foreground">Loading sources…</p>
                    ) : null}
                    {mergeChoicesError ? (
                      <p className="text-sm text-destructive">{mergeChoicesError}</p>
                    ) : null}
                    {mergeChoices ? (
                      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                        {mergeChoices.choices.map((choice) => {
                          const note = mergeChoiceNote(choice.role)
                          const checked = choice.role === 'destination' || (choice.role === 'add' && includedSourceKeys.has(choice.key))
                          return (
                            <label
                              key={choice.key}
                              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={choice.role !== 'add' || mergePending}
                                onChange={() => toggleMergeSource(choice.key)}
                                className={`${checkboxClassName} mt-1`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">
                                  {choice.title ?? choice.url ?? 'Untitled source'}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {choice.notebookTitle}
                                  {note ? ` - ${note}` : ''}
                                </span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <DialogFooter>
                  <DialogClose type="button" disabled={mergePending}>
                    Cancel
                  </DialogClose>
                  <Button
                    type="submit"
                    disabled={
                      mergePending
                      || (mergeMode === 'new' && !mergeTitle.trim())
                      || (mergeOverCap && mergeChoicesLoading)
                      || (mergeSelectedUrls != null && (mergeSelectionOverCap || mergeSelectedUrls.length === 0))
                    }
                  >
                    {mergePending ? 'Merging…' : 'Merge'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedCount} notebooks?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the selected notebooks from NotebookLM
                and removes them from your local cache. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {bulkDeleteError ? (
              <p className="text-sm text-destructive">{bulkDeleteError}</p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bulkDeletePending}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={bulkDeletePending}
                onClick={() => void confirmBulkDelete()}
              >
                {bulkDeletePending ? 'Deleting…' : `Delete ${selectedCount}`}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </div>
  )
}