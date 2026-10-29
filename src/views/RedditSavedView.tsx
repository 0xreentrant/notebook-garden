import { memo, useMemo, useState, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpenIcon,
  CopyIcon,
  ExternalLinkIcon,
  PinIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  createNotebookForVideo,
  saveRedditNotebookUrl,
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
import { ConnectorNotebookAdd } from '@/components/ConnectorNotebookAdd'
import { useTabSelection } from '@/hooks/useTabSelection'
import { useInfiniteList } from '@/hooks/useInfiniteList'
import { useThrottledValue } from '@/hooks/useThrottledValue'
import { truncateNotebookTitle } from '@/lib/notebook-links'
import type { RedditSavedItemRow } from '@/types'

const fieldClassName =
  'h-8 w-full rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const markdownComponents = {
  a: ({ href, children, ...props }: ComponentProps<'a'>) => (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

function displayTitle(item: RedditSavedItemRow) {
  return item.title?.trim() || item.reddit_name
}

function redditHosted(url: string) {
  return url.includes('reddit.com') || url.includes('redd.it')
}

const RedditCard = memo(function RedditCard({
  item,
  selected,
  onSelectedChange,
  onDelete,
  onPinned,
  onViewed,
  onNotebookCreated,
}: {
  item: RedditSavedItemRow
  selected: boolean
  onSelectedChange: (id: number, checked: boolean) => void
  onDelete: (id: number) => Promise<void>
  onPinned: (item: RedditSavedItemRow) => void
  onViewed: (item: RedditSavedItemRow) => void
  onNotebookCreated: (item: RedditSavedItemRow) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [fullBody, setFullBody] = useState<string | null>(null)
  const preview = item.content_text || ''
  const body = fullBody ?? preview
  const textOverflow = Boolean(item.text_overflow) || (
    fullBody != null && fullBody.length > preview.length
  )
  const hosted = redditHosted(item.url)

  async function loadFullBody() {
    if (fullBody != null || !item.text_overflow) return fullBody ?? preview
    const response = await fetch(`/api/reddit-saved/${item.id}`)
    if (!response.ok) return preview
    const row = (await response.json()) as RedditSavedItemRow
    const next = row.content_text || ''
    setFullBody(next)
    return next
  }

  async function createNotebook() {
    setBusy(true)
    setError(null)
    try {
      const result = await createNotebookForVideo(displayTitle(item), item.url)
      if (!result.notebookUrl) {
        throw new Error(result.error ?? 'Notebook create failed')
      }
      const updated = await saveRedditNotebookUrl(
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
    const text = await loadFullBody()
    if (!text) return
    await navigator.clipboard.writeText(text)
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(item.id, event.target.checked)}
            aria-label={`Select ${displayTitle(item)}`}
            className="mt-1 size-3.5 shrink-0 rounded border-border accent-primary"
          />
        <CardTitle className="text-base leading-snug">
          <a
            href={item.permalink || item.url}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
            onClick={() => onViewed(item)}
          >
            {displayTitle(item)}
          </a>
        </CardTitle>
        </div>
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
                  Soft-deletes locally only. Reddit Saved is unchanged.
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
          <span>{item.kind}</span>
          {item.subreddit ? <span>r/{item.subreddit}</span> : null}
          {item.author ? <span>u/{item.author}</span> : null}
          {item.over_18 ? <span>nsfw</span> : null}
        </div>
        {body ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {open ? body : body.slice(0, 420)}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted-foreground">No captured text.</p>
        )}
        {body.length > 0 && textOverflow ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!open) void loadFullBody()
              setOpen((value) => !value)
            }}
          >
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
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border px-2.5 text-[0.8rem]"
          >
            <ExternalLinkIcon className="size-3.5" />
            {hosted ? 'Reddit' : 'Link'}
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
        {hosted ? (
          <p className="text-xs text-muted-foreground">
            NotebookLM may not fetch Reddit pages. Prefer Copy text for the saved body.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
})

export default function RedditSavedView() {
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
  } = useInfiniteList<RedditSavedItemRow>('/api/reddit-saved', filters)

  const { selectedIds, toggleSelected, clearSelection } = useTabSelection('reddit', items, loading)

  const rows = useMemo(
    () =>
      buildPinnedRows(items, true, { pinned: 'Pinned', rest: 'Saved' }, { showStatus: true }),
    [items],
  )

  async function onDelete(id: number) {
    const response = await fetch(`/api/reddit-saved/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      setLocalError(`Delete failed (${response.status})`)
      return
    }
    removeItem(id)
  }

  async function onPinned(item: RedditSavedItemRow) {
    const response = await fetch(`/api/reddit-saved/${item.id}`, {
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

  async function onViewed(item: RedditSavedItemRow) {
    if (item.last_viewed) return
    const response = await fetch(`/api/reddit-saved/${item.id}`, {
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
        <h2 className="text-lg font-medium">Reddit Saved</h2>
        <p className="text-sm text-muted-foreground">
          Local copies of your Reddit saved posts and comments. The collect script reads your logged-in Saved page and does not unsave.
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

      <ConnectorNotebookAdd
        onCleared={clearSelection}
        onUpdated={(resource, row) => {
          if (resource.connector === 'reddit') replaceItem(row as RedditSavedItemRow)
        }}
      />

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Reddit saves yet. Run <code className="text-xs">npm run reddit:saved-collect -- --limit 5</code>
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
              <RedditCard
                item={item}
                selected={selectedIds.has(item.id)}
                onSelectedChange={(id, checked) => {
                  const row = items.find((entry) => entry.id === id)
                  toggleSelected(
                    id,
                    checked,
                    row ? { title: displayTitle(row), url: row.url } : undefined,
                  )
                }}
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
