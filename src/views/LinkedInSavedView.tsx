import { memo, useMemo, useState } from 'react'
import {
  BookOpenIcon,
  CopyIcon,
  ExternalLinkIcon,
  PinIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  createNotebookForVideo,
  saveLinkedInNotebookUrl,
} from '@/notebooklm-importer'
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
  buildPinnedRows,
  VirtualizedList,
} from '@/components/VirtualizedList'
import { useInfiniteList } from '@/hooks/useInfiniteList'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { truncateNotebookTitle } from '@/lib/notebook-links'
import type { LinkedInSavedItemRow } from '@/types'

const fieldClassName =
  'h-8 w-full rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function plantUrl(item: LinkedInSavedItemRow) {
  if (item.item_type === 'article' && item.source_url) return item.source_url
  return item.linkedin_url
}

function displayTitle(item: LinkedInSavedItemRow) {
  return item.title?.trim() || item.author_name || item.linkedin_urn
}

const LinkedInCard = memo(function LinkedInCard({
  item,
  onDelete,
  onPinned,
  onViewed,
  onNotebookCreated,
}: {
  item: LinkedInSavedItemRow
  onDelete: (id: number) => Promise<void>
  onPinned: (item: LinkedInSavedItemRow) => void
  onViewed: (item: LinkedInSavedItemRow) => void
  onNotebookCreated: (item: LinkedInSavedItemRow) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const body = item.summary_text || item.content_text || ''

  async function createNotebook() {
    setBusy(true)
    setError(null)
    try {
      const url = plantUrl(item)
      const result = await createNotebookForVideo(displayTitle(item), url)
      if (!result.notebookUrl) {
        throw new Error(result.error ?? 'Notebook create failed')
      }
      const updated = await saveLinkedInNotebookUrl(
        item.id,
        result.notebookUrl,
        displayTitle(item),
      )
      onNotebookCreated(updated)
      onViewed(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copyContent() {
    if (!body) return
    await navigator.clipboard.writeText(body)
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base leading-snug">
          <a
            href={plantUrl(item)}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
            onClick={() => onViewed(item)}
          >
            {displayTitle(item)}
          </a>
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant={item.pinned ? 'default' : 'ghost'}
            aria-label={item.pinned ? 'Unpin' : 'Pin'}
            onClick={() => onPinned(item)}
          >
            <PinIcon className="size-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Delete" />
              }
            >
              <Trash2Icon className="size-4" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove saved item?</AlertDialogTitle>
                <AlertDialogDescription>
                  Soft-deletes locally only. LinkedIn Saved is unchanged.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onDelete(item.id)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{item.item_type}</span>
          <span>{item.capture_status}</span>
          <span>enrich:{item.enrichment_status}</span>
          {item.author_name ? <span>{item.author_name}</span> : null}
        </div>
        {body ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {open ? body : body.slice(0, 420)}
          </div>
        ) : (
          <p className="text-muted-foreground">No captured text.</p>
        )}
        {body.length > 420 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Show less' : 'Show more'}
          </Button>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void createNotebook()}>
            <BookOpenIcon className="size-4" />
            {busy ? 'Creating…' : 'Create notebook'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyContent()}>
            <CopyIcon className="size-4" />
            Copy text
          </Button>
          <a
            href={item.linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border px-2.5 text-[0.8rem]"
          >
            <ExternalLinkIcon className="size-3.5" />
            LinkedIn
          </a>
          {item.notebooklm_links[0] ? (
            <a
              href={item.notebooklm_links[0].url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border px-2.5 text-[0.8rem]"
            >
              {truncateNotebookTitle(item.notebooklm_links[0].title)}
            </a>
          ) : null}
        </div>
        {item.item_type === 'activity' ? (
          <p className="text-xs text-muted-foreground">
            Activity plant uses the LinkedIn URL (may be auth-gated). Prefer Copy text for durable content.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
})

export default function LinkedInSavedView() {
  const [search, setSearch] = useState('')
  const throttledSearch = useThrottledValue(search, 200)
  const [localError, setLocalError] = useState<string | null>(null)

  const filters = useMemo(
    () => ({
      search: throttledSearch,
      searchScope: 'all' as const,
      sort: 'newest' as const,
      pinsAtTop: true,
      view: 'all' as const,
      notebook: 'all' as const,
      tag: '',
    }),
    [throttledSearch],
  )

  const {
    items,
    total,
    loading,
    loadingMore,
    hasMore,
    error: listError,
    loadMoreError,
    loadMore,
    replaceItem,
    removeItem,
    reload,
  } = useInfiniteList<LinkedInSavedItemRow>('/api/linkedin-saved', filters)

  const rows = useMemo(
    () =>
      buildPinnedRows(items, true, { pinned: 'Pinned', rest: 'Saved' }, { showStatus: true }),
    [items],
  )

  async function onDelete(id: number) {
    const response = await fetch(`/api/linkedin-saved/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      setLocalError(`Delete failed (${response.status})`)
      return
    }
    removeItem(id)
  }

  async function onPinned(item: LinkedInSavedItemRow) {
    const response = await fetch(`/api/linkedin-saved/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !item.pinned }),
    })
    if (!response.ok) {
      setLocalError(`Pin failed (${response.status})`)
      return
    }
    replaceItem(await response.json())
  }

  async function onViewed(item: LinkedInSavedItemRow) {
    if (item.last_viewed) return
    const response = await fetch(`/api/linkedin-saved/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_viewed: true }),
    })
    if (!response.ok) return
    replaceItem(await response.json())
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">LinkedIn Saved</h2>
        <p className="text-sm text-muted-foreground">
          Local captures from LinkedIn Saved. Collection is read-only; unsaving is a separate command.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 space-y-1 text-sm">
          <span className="text-muted-foreground">Search</span>
          <input
            className={fieldClassName}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="title, author, text…"
          />
        </label>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
          Reload
        </Button>
        <span className="text-xs text-muted-foreground">{total} items</span>
      </div>

      {localError || listError ? (
        <Alert variant="destructive">
          <AlertDescription>{localError ?? listError}</AlertDescription>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No LinkedIn items yet. Run{' '}
          <code className="text-xs">python3 scripts/linkedin/li-collect.py --limit 5</code>
        </p>
      ) : (
        <VirtualizedList
          rows={rows}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          estimateSize={(row) => {
            if (row.type === 'header') return 28
            if (row.type === 'status') return 48
            return 240
          }}
          renderRow={(row) => {
            if (row.type === 'header') {
              return (
                <h2 className="text-sm font-medium text-muted-foreground">{row.label}</h2>
              )
            }
            if (row.type === 'status') {
              return (
                <div className="py-2 text-center text-sm text-muted-foreground">
                  {loadMoreError ? loadMoreError : loadingMore || hasMore ? 'Loading more…' : null}
                </div>
              )
            }
            const item = items[row.index]
            if (!item) return null
            return (
              <LinkedInCard
                item={item}
                onDelete={onDelete}
                onPinned={onPinned}
                onViewed={onViewed}
                onNotebookCreated={replaceItem}
              />
            )
          }}
        />
      )}
    </section>
  )
}
