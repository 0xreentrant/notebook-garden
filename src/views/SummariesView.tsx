import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpenIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  PinIcon,
  TagPlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import {
  addVideosToNotebook,
  bulkCreateNotebookForVideos,
  createNotebookForVideo,
  defaultBulkNotebookTitle,
  saveNotebookUrl,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
  formatTimestamp,
  PINS_AT_TOP_KEY,
  readPinsAtTop,
  selectClassName,
  type NotebookFilter,
  type SearchScope,
  type SortKey,
  type ViewFilter,
} from '@/lib/entry-list'
import { normalizeTag } from '@/lib/tags'
import {
  truncateNotebookTitle,
} from '@/lib/notebook-links'
import { searchNotebooks, sortNotebooks } from '@/lib/notebook-list'
import { prepareSummaryMarkdown } from '@/summary-markdown'
import type { NotebookRow, SummaryEntryRow } from '@/types'

const fieldClassName =
  'h-8 w-full rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const checkboxClassName = 'size-3.5 shrink-0 rounded border-border accent-primary'

const markdownComponents = {
  a: ({ href, children, ...props }: ComponentProps<'a'>) => (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

const SummaryMarkdown = memo(function SummaryMarkdown({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {body}
      </ReactMarkdown>
    </div>
  )
})

function statusVariant(status: SummaryEntryRow['status']) {
  if (status === 'complete') return 'default' as const
  if (status === 'pending') return 'secondary' as const
  return 'destructive' as const
}

const EntryCard = memo(function EntryCard({
  entry,
  selected,
  open,
  onOpenChange,
  onSelectedChange,
  onDelete,
  onNotebookCreated,
  onViewed,
  onPinned,
  onTagsChange,
  allTags,
}: {
  entry: SummaryEntryRow
  selected: boolean
  open: boolean
  onOpenChange: (id: number, open: boolean) => void
  onSelectedChange: (id: number, checked: boolean) => void
  onDelete: (id: number) => Promise<void>
  onNotebookCreated: (entry: SummaryEntryRow) => void
  onViewed: (entry: SummaryEntryRow) => void
  onPinned: (entry: SummaryEntryRow) => void
  onTagsChange: (entry: SummaryEntryRow, tags: string[]) => Promise<void>
  allTags: string[]
}) {
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagInputOpen, setTagInputOpen] = useState(false)

  const body = useMemo(() => {
    if (entry.status === 'error') {
      return entry.error_message ? `_${entry.error_message}_` : null
    }
    return entry.summary_text
      ? prepareSummaryMarkdown(entry.summary_text, entry.url)
      : null
  }, [entry.status, entry.error_message, entry.summary_text, entry.url])

  async function markViewed() {
    try {
      const response = await fetch(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_viewed: true }),
      })
      if (!response.ok) return
      const updated = (await response.json()) as SummaryEntryRow
      onViewed(updated)
    } catch {
      // fire-and-forget
    }
  }

  async function togglePinned() {
    try {
      const response = await fetch(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !entry.pinned }),
      })
      if (!response.ok) return
      const updated = (await response.json()) as SummaryEntryRow
      onPinned(updated)
    } catch {
      // fire-and-forget
    }
  }

  const availableTags = useMemo(
    () =>
      allTags.filter(
        (tag) => !entry.tags.includes(tag) && tag.includes(normalizeTag(tagDraft)),
      ),
    [allTags, entry.tags, tagDraft],
  )

  async function addTag(event: FormEvent) {
    event.preventDefault()
    const tag = normalizeTag(tagDraft)
    if (!tag || entry.tags.includes(tag)) {
      setTagDraft('')
      return
    }
    await onTagsChange(entry, [...entry.tags, tag])
    setTagDraft('')
    setTagInputOpen(false)
  }

  async function selectExistingTag(tag: string) {
    if (entry.tags.includes(tag)) return
    await onTagsChange(entry, [...entry.tags, tag])
    setTagDraft('')
    setTagInputOpen(false)
  }

  async function removeTag(tag: string) {
    await onTagsChange(entry, entry.tags.filter((value) => value !== tag))
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(entry.id, nextOpen)
    if (nextOpen) void markViewed()
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete(entry.id)
    } finally {
      setDeleting(false)
    }
  }

  async function handleImportToNotebookLM() {
    setImportError(null)
    setImporting(true)
    const notebookTab = window.open('about:blank', '_blank', 'noopener,noreferrer')
    try {
      const result = await createNotebookForVideo(entry.title, entry.url)
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setImportError(result.error ?? 'Failed to create notebook')
        return
      }
      const updated = await saveNotebookUrl(entry.id, result.notebookUrl, entry.title)
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
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <Card className="entry-card">
        <CardHeader className="gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectedChange(entry.id, event.target.checked)}
              aria-label={`Select ${entry.title}`}
              className={`${checkboxClassName} mt-1.5`}
            />
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mt-0.5 shrink-0 text-muted-foreground"
                  aria-label={open ? 'Collapse entry' : 'Expand entry'}
                />
              }
            >
              <ChevronDownIcon
                className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </CollapsibleTrigger>
            <CollapsibleTrigger
              render={
                <div
                  className="min-w-0 flex-1 cursor-pointer space-y-1 text-left"
                  aria-label={open ? 'Collapse entry' : 'Expand entry'}
                />
              }
            >
              <CardTitle className="leading-snug">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary"
                  onClick={(event) => event.stopPropagation()}
                >
                  {entry.title}
                </a>
              </CardTitle>
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLinkIcon className="size-3 shrink-0" />
                <span className="truncate">{entry.url}</span>
              </a>
              {entry.notebooklm_links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                  onClick={(event) => event.stopPropagation()}
                  title={link.title}
                >
                  <BookOpenIcon className="size-3 shrink-0" />
                  <span className="truncate">{truncateNotebookTitle(link.title)}</span>
                </a>
              ))}
              <div
                className="flex flex-wrap items-center gap-1.5 pt-1"
                onClick={(event) => event.stopPropagation()}
              >
                {entry.tags.map((tag) => (
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
                <div className="relative pt-1" onClick={(event) => event.stopPropagation()}>
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
            </CollapsibleTrigger>
          </div>
          <CardAction className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className={
                entry.pinned
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }
              aria-label={entry.pinned ? 'Unpin entry' : 'Pin entry'}
              onClick={() => void togglePinned()}
            >
              <PinIcon className={`size-4 ${entry.pinned ? 'fill-current' : ''}`} />
            </Button>
            <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
          </CardAction>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {entry.notebooklm_links.length === 0 ? (
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
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                    />
                  }
                >
                  <Trash2Icon />
                  Delete
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete entry?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes &ldquo;{entry.title}&rdquo; from summaries.db.
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
              Added {formatTimestamp(entry.created_at)}
              {entry.last_viewed ? (
                <> · Viewed {formatTimestamp(entry.last_viewed)}</>
              ) : null}
            </p>
            {body ? (
              <SummaryMarkdown body={body} />
            ) : (
              <p className="text-sm text-muted-foreground">No summary yet.</p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
})

const SEARCH_THROTTLE_MS = 400

const SEARCH_SCOPES: { value: SearchScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'title', label: 'Titles only' },
  { value: 'tags', label: 'Tags only' },
]

function EntrySearch({
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
          placeholder="Search entries…"
          aria-label="Search entries"
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

export default function SummariesView() {
  const [sortKey, setSortKey] = useState<SortKey>('created_desc')
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [notebookFilter, setNotebookFilter] = useState<NotebookFilter>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [filterQuery, setFilterQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const deferredFilterQuery = useDeferredValue(filterQuery)
  const [pinsAtTop, setPinsAtTop] = useState(readPinsAtTop)
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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const [, startExpandTransition] = useTransition()

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
    items: entries,
    tags: allTags,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMoreError,
    loadMore,
    replaceItem,
    removeItem,
  } = useInfiniteList<SummaryEntryRow>('/api/entries', listFilters)

  useEffect(() => {
    if (tagFilter !== 'all' && !allTags.includes(tagFilter)) {
      setTagFilter('all')
    }
  }, [allTags, tagFilter])

  const selectedCount = selectedIds.size

  const rows = useMemo(
    () =>
      buildPinnedRows(entries, pinsAtTop, { pinned: 'Pinned', rest: 'Entries' }, {
        showStatus: hasMore || loadingMore || Boolean(loadMoreError),
      }),
    [entries, pinsAtTop, hasMore, loadingMore, loadMoreError],
  )

  useEffect(() => {
    const visibleIdSet = new Set(entries.map((entry) => entry.id))
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIdSet.has(id)))
      return next.size === prev.size ? prev : next
    })
    setExpandedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIdSet.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [entries])

  useEffect(() => {
    localStorage.setItem(PINS_AT_TOP_KEY, String(pinsAtTop))
  }, [pinsAtTop])

  const deleteEntry = useCallback(async (id: number) => {
    const response = await fetch(`/api/entries/${id}`, { method: 'DELETE' })
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

  const toggleExpanded = useCallback((id: number, isOpen: boolean) => {
    setExpandedIds((prev) => {
      if (isOpen === prev.has(id)) return prev
      const next = new Set(prev)
      if (isOpen) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    startExpandTransition(() => {
      setExpandedIds(new Set(entries.map((entry) => entry.id)))
    })
  }, [entries])

  const collapseAll = useCallback(() => {
    startExpandTransition(() => {
      setExpandedIds(new Set())
    })
  }, [])

  function selectedEntries() {
    return entries.filter((entry) => selectedIds.has(entry.id))
  }

  const handleTagsChange = useCallback(
    async (entry: SummaryEntryRow, tags: string[]) => {
      const response = await fetch(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      })
      if (!response.ok) return
      replaceItem((await response.json()) as SummaryEntryRow)
    },
    [replaceItem],
  )

  async function bulkSetPinned(pinned: boolean) {
    const targets = selectedEntries().filter((entry) => Boolean(entry.pinned) !== pinned)
    for (const entry of targets) {
      const response = await fetch(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      })
      if (!response.ok) continue
      replaceItem((await response.json()) as SummaryEntryRow)
    }
  }

  async function confirmBulkTag(event: FormEvent) {
    event.preventDefault()
    const tag = normalizeTag(bulkTagDraft)
    if (!tag) return
    setBulkTagPending(true)
    try {
      const targets = selectedEntries().filter((entry) => !entry.tags.includes(tag))
      for (const entry of targets) {
        const response = await fetch(`/api/entries/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: [...entry.tags, tag] }),
        })
        if (!response.ok) continue
        replaceItem((await response.json()) as SummaryEntryRow)
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
      for (const entry of selectedEntries()) {
        await deleteEntry(entry.id)
      }
      clearSelection()
      setBulkDeleteOpen(false)
    } catch (bulkError) {
      setBulkDeleteError(bulkError instanceof Error ? bulkError.message : String(bulkError))
    } finally {
      setBulkDeletePending(false)
    }
  }

  async function linkEntriesToNotebook(
    entries: SummaryEntryRow[],
    notebookUrl: string,
    title: string,
  ) {
    for (const entry of entries) {
      const updated = await saveNotebookUrl(entry.id, notebookUrl, title)
      replaceItem(updated)
    }
  }

  async function bulkInsertNewNotebook() {
    const entries = selectedEntries()
    if (entries.length === 0) return

    setBulkNotebookPending(true)
    setBulkNotebookError(null)
    const notebookTab = window.open('about:blank', '_blank', 'noopener,noreferrer')
    try {
      const urls = entries.map((entry) => entry.url)
      const title = defaultBulkNotebookTitle(entries)
      const result = await bulkCreateNotebookForVideos(title, urls)
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setBulkNotebookError(result.error ?? 'Failed to create notebook')
        return
      }
      await linkEntriesToNotebook(entries, result.notebookUrl, title)
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
    const entries = selectedEntries()
    const notebook = bulkNotebookOptions.find((row) => row.id === bulkNotebookPickerId)
    if (entries.length === 0 || !notebook) return

    setBulkNotebookPending(true)
    setBulkNotebookError(null)
    const notebookTab = window.open(notebook.url, '_blank', 'noopener,noreferrer')
    try {
      const result = await addVideosToNotebook(
        notebook.notebooklm_id,
        entries.map((entry) => entry.url),
      )
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setBulkNotebookError(result.error ?? 'Failed to add sources')
        return
      }
      await linkEntriesToNotebook(entries, result.notebookUrl, notebook.title)
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

  function renderEntry(entry: SummaryEntryRow) {
    return (
      <EntryCard
        key={entry.id}
        entry={entry}
        selected={selectedIds.has(entry.id)}
        open={expandedIds.has(entry.id)}
        onOpenChange={toggleExpanded}
        onSelectedChange={toggleSelected}
        onDelete={deleteEntry}
        onNotebookCreated={replaceItem}
        onViewed={replaceItem}
        onPinned={replaceItem}
        onTagsChange={handleTagsChange}
        allTags={allTags}
      />
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="space-y-4">
          <EntrySearch
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
              {loading ? 'Loading summaries…' : `${total} entries`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={expandAll}>
                Expand all
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                Collapse all
              </Button>
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
                  onChange={(event) =>
                    setSortKey(event.target.value as SortKey)
                  }
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

        {!loading && entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? 'No entries in summaries.db yet.'
              : 'No entries match.'}
          </p>
        ) : null}

        {entries.length > 0 || loadingMore || loadMoreError ? (
          <VirtualizedList
            rows={rows}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
            estimateSize={(row) => {
              if (row.type === 'header') return 28
              if (row.type === 'status') return 48
              return 200
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
              return renderEntry(entries[row.index])
            }}
          />
        ) : null}

        <Dialog open={bulkTagOpen} onOpenChange={setBulkTagOpen}>
          <DialogContent>
            <form onSubmit={(event) => void confirmBulkTag(event)}>
              <DialogHeader>
                <DialogTitle>Add tag to {selectedCount} entries</DialogTitle>
                <DialogDescription>
                  Adds the tag to each selected entry that does not already have it.
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
              <DialogTitle>Add {selectedCount} videos to notebook</DialogTitle>
              <DialogDescription>
                Choose an existing NotebookLM notebook. Selected YouTube URLs are added as sources.
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
                        name="bulk-notebook-target"
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
              <AlertDialogTitle>Delete {selectedCount} entries?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the selected entries from summaries.db.
                This cannot be undone.
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