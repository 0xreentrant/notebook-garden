import { useDeferredValue, useMemo, useState } from 'react'
import { BookOpenIcon } from 'lucide-react'
import { fetchNotebooks } from '@/api/notebooks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SourceCapChecklist } from '@/components/SourceCapChecklist'
import {
  clearConnectorSelections,
  selectedConnectorResources,
  type SelectedResource,
} from '@/hooks/useTabSelection'
import { searchNotebooks, sortNotebooks } from '@/lib/notebook-list'
import { planResourceSources, type SourceChecklistPlan } from '@/lib/source-checklist'
import { linkConnectorResources, notebookLinkBaseline } from '@/lib/connector-notebook-add'
import {
  addVideosToNotebook,
  bulkCreateNotebookForVideos,
} from '@/notebooklm-importer'
import type { NotebookRow } from '@/types'

const fieldClassName =
  'h-8 w-full rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const checkboxClassName = 'size-3.5 shrink-0 rounded border-border accent-primary'

function notebookTitle(resources: { title: string }[]) {
  if (resources.length === 1) return resources[0].title
  return `Imported sources (${resources.length})`
}

export function ConnectorNotebookAdd({
  onCleared,
  onUpdated,
}: {
  onCleared: () => void
  onUpdated?: (resource: SelectedResource, row: unknown) => void
}) {
  const resources = selectedConnectorResources()
  const [existingOpen, setExistingOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerId, setPickerId] = useState<number | null>(null)
  const [options, setOptions] = useState<NotebookRow[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [sourceCapPlan, setSourceCapPlan] = useState<SourceChecklistPlan | null>(null)
  const [sourceCapNotebook, setSourceCapNotebook] = useState<NotebookRow | null>(null)
  const deferredFilterQuery = useDeferredValue(filterQuery)
  const filteredOptions = useMemo(
    () => searchNotebooks(options, deferredFilterQuery),
    [options, deferredFilterQuery],
  )

  if (resources.length === 0 && !existingOpen && !sourceCapPlan) return null

  async function linkIncluded(
    rows: SelectedResource[],
    urls: string[],
    notebookUrl: string,
    title: string,
    baseline: Map<string, string | null>,
  ) {
    const linked = await linkConnectorResources({
      resources: rows,
      urls,
      notebookUrl,
      title,
      baseline,
    })
    for (const item of linked) onUpdated?.(item.resource, item.row)
  }

  function finish(keepSelection: boolean) {
    if (!keepSelection) {
      clearConnectorSelections()
      onCleared()
    }
  }

  async function insertNew(chosenUrls?: string[], keepSelection = false) {
    const rows = selectedConnectorResources()
    if (rows.length === 0) return false
    let urls = chosenUrls
    if (!urls) {
      const plan = planResourceSources({ destinationSourceCount: 0, resources: rows })
      if (plan.action === 'checklist') {
        setSourceCapNotebook(null)
        setSourceCapPlan(plan)
        return false
      }
      urls = plan.urls
    }
    const included = rows.filter((resource) => urls.includes(resource.url))
    setPending(true)
    setError(null)
    const baseline = await notebookLinkBaseline(included)
    const notebookTab = window.open('about:blank', '_blank', 'noopener,noreferrer')
    try {
      const title = notebookTitle(included)
      const result = await bulkCreateNotebookForVideos(title, urls)
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setError(result.error ?? 'Failed to create notebook')
        return false
      }
      await linkIncluded(rows, urls, result.notebookUrl, title, baseline)
      finish(keepSelection)
      if (notebookTab) notebookTab.location.href = result.notebookUrl
      else window.open(result.notebookUrl, '_blank', 'noopener,noreferrer')
      return true
    } catch (err) {
      notebookTab?.close()
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setPending(false)
    }
  }

  async function openExisting() {
    setSourceCapPlan(null)
    setSourceCapNotebook(null)
    setError(null)
    setPickerId(null)
    setFilterQuery('')
    setExistingOpen(true)
    setOptionsLoading(true)
    try {
      const notebooks = await fetchNotebooks()
      const sorted = sortNotebooks(notebooks, 'created_desc')
      setOptions(sorted)
      if (sorted.length === 1) setPickerId(sorted[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOptions([])
    } finally {
      setOptionsLoading(false)
    }
  }

  async function addExisting(chosenUrls?: string[], keepSelection = false) {
    const rows = selectedConnectorResources()
    const notebook = sourceCapNotebook ?? options.find((row) => row.id === pickerId)
    if (rows.length === 0 || !notebook) return false
    let urls = chosenUrls
    if (!urls) {
      const plan = planResourceSources({
        destinationSourceCount: notebook.source_count,
        resources: rows,
      })
      if (plan.action === 'checklist') {
        setSourceCapNotebook(notebook)
        setSourceCapPlan(plan)
        return false
      }
      urls = plan.urls
    }
    const included = rows.filter((resource) => urls.includes(resource.url))
    setPending(true)
    setError(null)
    const baseline = await notebookLinkBaseline(included)
    const notebookTab = window.open(notebook.url, '_blank', 'noopener,noreferrer')
    try {
      const result = await addVideosToNotebook(notebook.notebooklm_id, urls)
      if (result.error || !result.notebookUrl) {
        notebookTab?.close()
        setError(result.error ?? 'Failed to add sources')
        return false
      }
      await linkIncluded(rows, urls, result.notebookUrl, notebook.title, baseline)
      finish(keepSelection)
      setExistingOpen(false)
      setPickerId(null)
      return true
    } catch (err) {
      notebookTab?.close()
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || resources.length === 0}
        onClick={() => void insertNew()}
      >
        <BookOpenIcon className="size-3.5" />
        Bulk insert to new notebook
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || resources.length === 0}
        onClick={() => void openExisting()}
      >
        <BookOpenIcon className="size-3.5" />
        Bulk add to existing notebook
      </Button>
      {error && !existingOpen && !sourceCapPlan ? (
        <p className="w-full text-sm text-destructive">{error}</p>
      ) : null}
      <Dialog
        open={existingOpen}
        onOpenChange={(open) => {
          setExistingOpen(open)
          if (!open) {
            setPickerId(null)
            setFilterQuery('')
            setError(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add {resources.length} sources to notebook</DialogTitle>
            <DialogDescription>
              Includes every selected YouTube, bookmark, LinkedIn, and Reddit item. Matching URLs are added once.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <input
              type="search"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Search notebooks…"
              aria-label="Search notebooks"
              className={fieldClassName}
              disabled={optionsLoading || options.length === 0}
              autoFocus
            />
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {optionsLoading ? (
                <p className="text-sm text-muted-foreground">Loading notebooks…</p>
              ) : options.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notebooks in the local cache. Sync from Notebooks first.
                </p>
              ) : filteredOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notebooks match.</p>
              ) : (
                filteredOptions.map((notebook) => (
                  <label
                    key={notebook.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
                  >
                    <input
                      type="radio"
                      name="cross-connector-notebook"
                      checked={pickerId === notebook.id}
                      onChange={() => setPickerId(notebook.id)}
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <DialogClose type="button" disabled={pending}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              disabled={pending || optionsLoading || pickerId == null}
              onClick={() => void addExisting()}
            >
              {pending ? 'Adding…' : 'Add to notebook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SourceCapChecklist
        plan={sourceCapPlan}
        mode={sourceCapNotebook ? 'existing' : 'new'}
        pending={pending}
        error={sourceCapPlan ? error : null}
        onCancel={() => {
          setSourceCapPlan(null)
          setSourceCapNotebook(null)
        }}
        onConfirm={(urls) => {
          void (async () => {
            const ok = sourceCapNotebook
              ? await addExisting(urls, true)
              : await insertNew(urls, true)
            if (ok) {
              setSourceCapPlan(null)
              setSourceCapNotebook(null)
            }
          })()
        }}
      />
    </div>
  )
}
