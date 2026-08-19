import { listCachedNotebooks, upsertNotebookItem } from './notebook-db'
import { withNotebooklmCookie } from './notebooklm/notebooklm-auth'
import {
  addYouTubeSourcesViaApi,
  bulkCreateAndImportViaApi,
  createAndImportViaApi,
  NOTEBOOK_URL_PREFIX,
  type NotebookSummary,
} from './notebooklm/notebooklm'

export type CreateNotebookResult = {
  success?: boolean
  notebookId?: string
  notebookUrl?: string
  error?: string
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
): Promise<{ success?: boolean; notebookUrl?: string; error?: string }> {
  try {
    await withNotebooklmCookie((cookie) => addYouTubeSourcesViaApi(cookie, notebooklmId, urls))
    const cached = listCachedNotebooks().find((notebook) => notebook.notebooklm_id === notebooklmId)
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
): Promise<{ success?: boolean; notebookUrl?: string; error?: string }> {
  return enqueueNotebooklmTask(() => runAddSourcesToNotebook(notebooklmId, urls))
}
