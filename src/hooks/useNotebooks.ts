import { useCallback } from 'react'
import {
  createNotebook as createNotebookApi,
  deleteNotebook as deleteNotebookApi,
  mergeNotebooks as mergeNotebooksApi,
  patchNotebook,
  previewMergeSources as previewMergeSourcesApi,
  renameNotebook as renameNotebookApi,
  syncNotebooks,
} from '@/api/notebooks'

export function useNotebooks() {
  const sync = useCallback(async () => {
    return syncNotebooks()
  }, [])

  const updateNotebook = useCallback(async (
    id: number,
    body: { last_viewed?: true; pinned?: boolean; tags?: string[]; title?: string },
  ) => {
    return patchNotebook(id, body)
  }, [])

  const rename = useCallback(async (id: number, notebooklmId: string, title: string) => {
    return renameNotebookApi(id, notebooklmId, title)
  }, [])

  const remove = useCallback(async (id: number, notebooklmId: string) => {
    await deleteNotebookApi(id, notebooklmId)
  }, [])

  const create = useCallback(async (title?: string) => {
    const created = await createNotebookApi(title)
    const remote = await sync()
    const notebook = remote.find((row) => row.notebooklm_id === created.notebooklmId)
    if (!notebook) {
      throw new Error('Created notebook not found after sync')
    }
    return { notebook, notebooks: remote }
  }, [sync])

  const merge = useCallback(async (input: {
    sourceNotebooklmIds: string[]
    destinationNotebooklmId?: string
    title?: string
    urls?: string[]
  }) => {
    return mergeNotebooksApi(input)
  }, [])

  const previewMerge = useCallback(async (input: {
    sourceNotebooklmIds: string[]
    destinationNotebooklmId?: string
  }) => {
    return previewMergeSourcesApi(input)
  }, [])

  return {
    sync,
    createNotebook: create,
    updateNotebook,
    renameNotebook: rename,
    deleteNotebook: remove,
    mergeNotebooks: merge,
    previewMergeSources: previewMerge,
  }
}
