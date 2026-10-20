import { listCachedNotebooks, upsertNotebookItem } from './notebook-db'
import { withNotebooklmCookie } from './notebooklm/notebooklm-auth'
import {
  buildMergeChecklist,
  candidateFromSourceRow,
  limitPlanToUrls,
  NOTEBOOKLM_SOURCE_CAP,
  planNotebookSourceMerge,
  sourceCapExceeded,
  sourceRowsFromGetNotebook,
  type MergeCandidate,
  type MergeChecklistItem,
  type SkippedMergeSource,
} from './notebooklm/notebook-merge'
import {
  addYouTubeSourcesViaApi,
  bulkCreateAndImportViaApi,
  createAndImportViaApi,
  createNotebookViaApi,
  fetchNotebookDetailViaApi,
  NOTEBOOK_URL_PREFIX,
  parseSourceCount,
  type NotebookSummary,
} from './notebooklm/notebooklm'

export type CreateNotebookResult = {
  success?: boolean
  notebookId?: string
  notebookUrl?: string
  error?: string
  status?: 400 | 500 | 502
}

let notebooklmQueue: Promise<unknown> = Promise.resolve()

function enqueueNotebooklmTask<T>(task: () => Promise<T>): Promise<T> {
  const run = notebooklmQueue.then(task)
  notebooklmQueue = run.then(() => {}, () => {})
  return run
}

function cacheNotebookSummary(summary: NotebookSummary) {
  upsertNotebookItem(summary)
}

export async function runNotebooklmImport(title: string, url: string): Promise<CreateNotebookResult> {
  try {
    const result = await withNotebooklmCookie((cookie) => createAndImportViaApi(cookie, title, url))
    const summary: NotebookSummary = {
      notebooklmId: result.notebookId,
      title,
      url: result.notebookUrl,
      created_at: new Date().toISOString(),
      last_viewed: null,
      source_count: 1,
    }
    cacheNotebookSummary(summary)
    return { success: true, ...result }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runBulkNotebooklmImport(
  title: string,
  urls: string[],
): Promise<CreateNotebookResult> {
  const blocked = sourceCapExceeded(0, urls)
  if (blocked) return { error: blocked, status: 400 }
  try {
    const result = await withNotebooklmCookie((cookie) =>
      bulkCreateAndImportViaApi(cookie, title, urls),
    )
    cacheNotebookSummary({
      notebooklmId: result.notebookId,
      title,
      url: result.notebookUrl,
      created_at: new Date().toISOString(),
      last_viewed: null,
      source_count: urls.length,
    })
    return { success: true, ...result }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runAddSourcesToNotebook(
  notebooklmId: string,
  urls: string[],
): Promise<{ success?: boolean; notebookUrl?: string; error?: string; status?: 400 | 500 | 502 }> {
  const cached = listCachedNotebooks().find((notebook) => notebook.notebooklm_id === notebooklmId)
  const blocked = sourceCapExceeded(cached?.source_count ?? 0, urls)
  if (blocked) return { error: blocked, status: 400 }
  try {
    await withNotebooklmCookie((cookie) => addYouTubeSourcesViaApi(cookie, notebooklmId, urls))
    const notebookUrl = cached?.url ?? `${NOTEBOOK_URL_PREFIX}${notebooklmId}`
    cacheNotebookSummary({
      notebooklmId,
      title: cached?.title ?? 'Notebook',
      url: notebookUrl,
      created_at: cached?.created_at ?? null,
      last_viewed: cached?.last_viewed ?? null,
      source_count: (cached?.source_count ?? 0) + urls.length,
    })
    return { success: true, notebookUrl }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function createNotebooklmImport(title: string, url: string): Promise<CreateNotebookResult> {
  return enqueueNotebooklmTask(() => runNotebooklmImport(title, url))
}

export async function createNotebooklmBulkImport(
  title: string,
  urls: string[],
): Promise<CreateNotebookResult> {
  return enqueueNotebooklmTask(() => runBulkNotebooklmImport(title, urls))
}

export async function addSourcesToNotebooklm(
  notebooklmId: string,
  urls: string[],
): Promise<{ success?: boolean; notebookUrl?: string; error?: string; status?: 400 | 500 | 502 }> {
  return enqueueNotebooklmTask(() => runAddSourcesToNotebook(notebooklmId, urls))
}

export type NotebookMergeReport = {
  destinationNotebooklmId: string
  destinationTitle: string
  destinationUrl: string
  addedCount: number
  skipped: SkippedMergeSource[]
  sourceCount: number
}

export type NotebookMergeFailure = {
  error: string
  status: 400 | 502
}

export type MergeSourcePreview = {
  destinationSourceCount: number
  cap: number
  choices: MergeChecklistItem[]
}

type MergeNotebookLoad = {
  id: string
  title: string
  sourceCount: number
  sources: MergeCandidate[]
}

function notebookRowFromDetail(detail: unknown): unknown[] | null {
  if (!Array.isArray(detail) || !Array.isArray(detail[0])) return null
  return detail[0]
}

function mergeInputError(
  input: {
    sourceNotebooklmIds: string[]
    destinationNotebooklmId?: string
    title?: string
  },
  requireTitle: boolean,
): { sourceIds: string[]; destinationId?: string; title: string } | NotebookMergeFailure {
  const sourceIds = [...new Set(input.sourceNotebooklmIds.map((id) => id.trim()).filter(Boolean))]
  const destinationId = input.destinationNotebooklmId?.trim() || undefined
  const title = input.title?.trim() ?? ''
  if (sourceIds.length < 2) {
    return { error: 'Select at least two notebooks to merge', status: 400 }
  }
  if (destinationId && !sourceIds.includes(destinationId)) {
    return { error: 'Destination must be one of the selected notebooks', status: 400 }
  }
  if (requireTitle && !destinationId && !title) {
    return { error: 'A destination notebook or a new title is required', status: 400 }
  }
  return { sourceIds, destinationId, title }
}

async function loadMergeNotebooks(cookie: string, ids: string[]): Promise<MergeNotebookLoad[]> {
  const loads: MergeNotebookLoad[] = []
  for (const id of ids) {
    const detail = await fetchNotebookDetailViaApi(cookie, id)
    const row = notebookRowFromDetail(detail)
    const sources = sourceRowsFromGetNotebook(detail).map(candidateFromSourceRow)
    const cached = listCachedNotebooks().find((notebook) => notebook.notebooklm_id === id)
    const title = cached?.title
      ?? (row && typeof row[0] === 'string' && row[0].trim() ? row[0] : 'Notebook')
    loads.push({
      id,
      title,
      sourceCount: row && Array.isArray(row[1]) ? parseSourceCount(row) : sources.length,
      sources,
    })
  }
  return loads
}

async function runPreviewMerge(input: {
  sourceNotebooklmIds: string[]
  destinationNotebooklmId?: string
}): Promise<MergeSourcePreview | NotebookMergeFailure> {
  const parsed = mergeInputError(input, false)
  if ('error' in parsed) return parsed

  return withNotebooklmCookie(async (cookie) => {
    const loads = await loadMergeNotebooks(cookie, parsed.sourceIds)
    const destination = parsed.destinationId
      ? loads.find((notebook) => notebook.id === parsed.destinationId) ?? null
      : null
    const incoming = loads.filter((notebook) => notebook.id !== parsed.destinationId)
    return {
      destinationSourceCount: destination?.sourceCount ?? 0,
      cap: NOTEBOOKLM_SOURCE_CAP,
      choices: buildMergeChecklist({
        destination: destination ? { title: destination.title, sources: destination.sources } : null,
        incoming: incoming.map((notebook) => ({ title: notebook.title, sources: notebook.sources })),
      }),
    }
  })
}

async function runMergeNotebooks(input: {
  sourceNotebooklmIds: string[]
  destinationNotebooklmId?: string
  title?: string
  urls?: string[]
}): Promise<NotebookMergeReport | NotebookMergeFailure> {
  const parsed = mergeInputError(input, true)
  if ('error' in parsed) return parsed
  const { sourceIds, destinationId, title } = parsed

  return withNotebooklmCookie(async (cookie) => {
    const loads = await loadMergeNotebooks(cookie, sourceIds)
    const destination = destinationId
      ? loads.find((notebook) => notebook.id === destinationId) ?? null
      : null
    const incoming = loads
      .filter((notebook) => notebook.id !== destinationId)
      .flatMap((notebook) => notebook.sources)
    const plan = limitPlanToUrls(planNotebookSourceMerge({
      destinationSourceCount: destination?.sourceCount ?? 0,
      destinationUrls: destination?.sources.flatMap((source) => source.url ? [source.url] : []) ?? [],
      incoming,
    }), input.urls)
    if (plan.error) return { error: plan.error, status: 400 }

    let notebooklmId = destinationId
    let destinationTitle = title
    if (!notebooklmId) {
      if (plan.urlsToAdd.length === 0) {
        return {
          error: 'Nothing to merge. Every source was a duplicate or had no URL to copy.',
          status: 400,
        }
      }
      notebooklmId = await createNotebookViaApi(cookie, title)
      destinationTitle = title
    } else {
      destinationTitle = destination?.title ?? 'Notebook'
    }

    if (plan.urlsToAdd.length > 0) {
      try {
        await addYouTubeSourcesViaApi(cookie, notebooklmId, plan.urlsToAdd)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!destinationId) {
          cacheNotebookSummary({
            notebooklmId,
            title: destinationTitle,
            url: `${NOTEBOOK_URL_PREFIX}${notebooklmId}`,
            created_at: new Date().toISOString(),
            last_viewed: null,
            source_count: 0,
          })
        }
        return {
          error: destinationId
            ? `Failed to add sources: ${message}`
            : `Created "${destinationTitle}" but failed to add sources: ${message}`,
          status: 502,
        }
      }
    }

    const cached = listCachedNotebooks().find((notebook) => notebook.notebooklm_id === notebooklmId)
    const notebookUrl = cached?.url ?? `${NOTEBOOK_URL_PREFIX}${notebooklmId}`
    cacheNotebookSummary({
      notebooklmId,
      title: destinationTitle,
      url: notebookUrl,
      created_at: cached?.created_at ?? new Date().toISOString(),
      last_viewed: cached?.last_viewed ?? null,
      source_count: plan.projectedCount,
    })

    return {
      destinationNotebooklmId: notebooklmId,
      destinationTitle,
      destinationUrl: notebookUrl,
      addedCount: plan.urlsToAdd.length,
      skipped: plan.skipped,
      sourceCount: plan.projectedCount,
    }
  })
}

export async function previewMergeNotebooks(input: {
  sourceNotebooklmIds: string[]
  destinationNotebooklmId?: string
}): Promise<MergeSourcePreview | NotebookMergeFailure> {
  return enqueueNotebooklmTask(() => runPreviewMerge(input))
}

export async function mergeNotebooks(input: {
  sourceNotebooklmIds: string[]
  destinationNotebooklmId?: string
  title?: string
  urls?: string[]
}): Promise<NotebookMergeReport | NotebookMergeFailure> {
  return enqueueNotebooklmTask(() => runMergeNotebooks(input))
}
