import type { NotebookSyncPayload } from '../types'
import { listCachedNotebooks, upsertNotebooks } from './notebook-db'
import { withNotebooklmCookie } from './notebooklm/notebooklm-auth'
import { fetchNotebookListFromApi } from './notebooklm/notebooklm'
import type { NotebookRow } from '../types'

export async function syncRemoteNotebooks(): Promise<NotebookSyncPayload[]> {
  const remote = await withNotebooklmCookie((cookie) => fetchNotebookListFromApi(cookie))
  upsertNotebooks(remote)
  return remote
}

export async function syncRemoteNotebooksToCache(): Promise<NotebookRow[]> {
  await syncRemoteNotebooks()
  return listCachedNotebooks()
}
