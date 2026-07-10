import type { BookmarkRow, SummaryEntryRow } from './types'

export const NOTEBOOKLM_EXTENSION_ID = 'paacnibobhcimjiadlfhbflfkdcfiabl'

export type CreateNotebookResult = {
  success?: boolean
  notebookId?: string
  notebookUrl?: string
  error?: string
}

function createNotebookViaExtension(
  title: string,
  url: string,
): Promise<CreateNotebookResult> {
  const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome!
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage(
      NOTEBOOKLM_EXTENSION_ID,
      { cmd: 'create-and-import', title, url },
      (response: CreateNotebookResult | undefined) => {
        if (chromeApi.runtime.lastError) {
          resolve({ error: chromeApi.runtime.lastError.message })
          return
        }
        resolve(response ?? { error: 'No response from extension' })
      },
    )
  })
}

async function createNotebookViaApi(
  title: string,
  url: string,
): Promise<CreateNotebookResult> {
  const response = await fetch('/api/notebooklm/create-and-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, url }),
  })

  const payload = (await response.json().catch(() => ({}))) as CreateNotebookResult
  if (!response.ok) {
    return { error: payload.error ?? `HTTP ${response.status}` }
  }
  return payload
}

export function createNotebookForVideo(
  title: string,
  url: string,
): Promise<CreateNotebookResult> {
  const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome
  if (chromeApi?.runtime?.sendMessage) {
    return createNotebookViaExtension(title, url)
  }
  return createNotebookViaApi(title, url)
}

export async function saveNotebookUrl(
  entryId: number,
  notebookUrl: string,
  title = 'NotebookLM',
): Promise<SummaryEntryRow> {
  return saveResourceNotebookUrl(`/api/entries/${entryId}`, notebookUrl, title)
}

export async function saveBookmarkNotebookUrl(
  bookmarkId: number,
  notebookUrl: string,
  title = 'NotebookLM',
): Promise<BookmarkRow> {
  return saveResourceNotebookUrl(`/api/bookmarks/${bookmarkId}`, notebookUrl, title)
}

async function saveResourceNotebookUrl<T>(
  path: string,
  notebookUrl: string,
  title: string,
): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notebooklm_link: { url: notebookUrl, title },
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

export type BulkNotebookResult = {
  success?: boolean
  notebookId?: string
  notebookUrl?: string
  error?: string
}

export function defaultBulkNotebookTitle(entries: { title: string }[]) {
  if (entries.length === 1) return entries[0].title
  return `Imported videos (${entries.length})`
}

export function defaultBulkBookmarkNotebookTitle(entries: { title: string }[]) {
  if (entries.length === 1) return entries[0].title
  return `Imported bookmarks (${entries.length})`
}

export async function bulkCreateNotebookForVideos(
  title: string,
  urls: string[],
): Promise<BulkNotebookResult> {
  const response = await fetch('/api/notebooklm/bulk-create-and-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, urls }),
  })

  const payload = (await response.json().catch(() => ({}))) as BulkNotebookResult
  if (!response.ok) {
    return { error: payload.error ?? `HTTP ${response.status}` }
  }
  return payload
}

export async function addVideosToNotebook(
  notebooklmId: string,
  urls: string[],
): Promise<{ success?: boolean; notebookUrl?: string; error?: string }> {
  const response = await fetch('/api/notebooklm/add-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebooklmId, urls }),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean
    notebookUrl?: string
    error?: string
  }
  if (!response.ok) {
    return { error: payload.error ?? `HTTP ${response.status}` }
  }
  return payload
}
