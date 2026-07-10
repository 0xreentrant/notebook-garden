import { useCallback } from 'react'
import useSWR from 'swr'
import { fetchNotebooks, patchNotebook, renameNotebook, deleteNotebook, createNotebook, syncNotebooks } from '@/api/notebooks'
import type { NotebookRow } from '@/types'

const NOTEBOOKS_KEY = '/api/notebooks'

export function useNotebooks() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<NotebookRow[]>(
    NOTEBOOKS_KEY,
    fetchNotebooks,
    { revalidateOnFocus: false },
  )

  const sync = useCallback(async () => {
    const remote = await syncNotebooks()
    await mutate(remote, { revalidate: false })
    return remote
  }, [mutate])

  const updateNotebook = useCallback(async (
    id: number,
    body: { last_viewed?: true; pinned?: boolean; tags?: string[]; title?: string },
  ) => {
    const updated = await patchNotebook(id, body)
    await mutate(
      (current) => current?.map((notebook) => (notebook.id === id ? updated : notebook)),
      { revalidate: false },
    )
    return updated
  }, [mutate])

  const rename = useCallback(async (id: number, notebooklmId: string, title: string) => {
    const updated = await renameNotebook(id, notebooklmId, title)
    await mutate(
      (current) => current?.map((notebook) => (notebook.id === id ? updated : notebook)),
      { revalidate: false },
    )
    return updated
  }, [mutate])

  const remove = useCallback(async (id: number, notebooklmId: string) => {
    await deleteNotebook(id, notebooklmId)
    await mutate(
      (current) => current?.filter((notebook) => notebook.id !== id),
      { revalidate: false },
    )
  }, [mutate])

  const create = useCallback(async (title?: string) => {
    const created = await createNotebook(title)
    const remote = await sync()
    const notebook = remote.find((row) => row.notebooklm_id === created.notebooklmId)
    if (!notebook) {
      throw new Error('Created notebook not found after sync')
    }
    return { notebook, notebooks: remote }
  }, [sync])

  return {
    notebooks: data ?? [],
    error: error instanceof Error ? error.message : error ? String(error) : null,
    isLoading: isLoading || isValidating,
    sync,
    createNotebook: create,
    updateNotebook,
    renameNotebook: rename,
    deleteNotebook: remove,
    refresh: () => mutate(),
  }
}
