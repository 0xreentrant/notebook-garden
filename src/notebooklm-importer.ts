import type { SummaryEntryRow } from './types'

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
): Promise<SummaryEntryRow> {
  const response = await fetch(`/api/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebooklm_url: notebookUrl }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<SummaryEntryRow>
}
