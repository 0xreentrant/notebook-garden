import {
  buildListQueryString,
  DEFAULT_PAGE_SIZE,
  type ListPage,
  type ListPageQuery,
} from '@/lib/list-page'
import type { NotebookRow } from '@/types'

type NotebookListFilters = Omit<ListPageQuery, 'limit' | 'cursor'>

const defaultNotebookFilters: NotebookListFilters = {
  sort: 'created_desc',
  view: 'all',
  notebook: 'all',
  tag: 'all',
  search: '',
  searchScope: 'all',
  pinsAtTop: true,
}

export async function fetchNotebooksPage(
  filters: Partial<NotebookListFilters> & { cursor?: string | null; limit?: number } = {},
): Promise<ListPage<NotebookRow>> {
  const qs = buildListQueryString({
    ...defaultNotebookFilters,
    ...filters,
    limit: filters.limit ?? DEFAULT_PAGE_SIZE,
    cursor: filters.cursor ?? null,
  })
  const response = await fetch(`/api/notebooks?${qs}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
  return response.json() as Promise<ListPage<NotebookRow>>
}

/** Loads every notebook page - for pickers / sync consumers, not the Library list. */
export async function fetchNotebooks(): Promise<NotebookRow[]> {
  const items: NotebookRow[] = []
  let cursor: string | null = null
  do {
    const page = await fetchNotebooksPage({
      cursor,
      limit: 100,
      pinsAtTop: false,
      sort: 'created_desc',
    })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

export async function patchNotebook(
  id: number,
  body: { last_viewed?: true; pinned?: boolean; tags?: string[]; title?: string },
): Promise<NotebookRow> {
  const response = await fetch(`/api/notebooks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
  return response.json() as Promise<NotebookRow>
}

async function renameNotebookRemote(notebooklmId: string, title: string) {
  const response = await fetch('/api/notebooks/remote/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebooklmId, title }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
}

async function deleteNotebookRemote(notebooklmId: string) {
  const response = await fetch('/api/notebooks/remote/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebooklmId }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
}

export async function renameNotebook(
  id: number,
  notebooklmId: string,
  title: string,
): Promise<NotebookRow> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Title is required')
  await renameNotebookRemote(notebooklmId, trimmed)
  return patchNotebook(id, { title: trimmed })
}

export async function deleteNotebook(
  id: number,
  notebooklmId: string,
): Promise<void> {
  await deleteNotebookRemote(notebooklmId)
  const response = await fetch(`/api/notebooks/${id}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
}

type CreateNotebookRemoteResult = {
  notebooklmId: string
  title: string
  url: string
}

export async function createNotebook(title = 'Untitled notebook'): Promise<CreateNotebookRemoteResult> {
  const trimmed = title.trim() || 'Untitled notebook'
  const response = await fetch('/api/notebooks/remote/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: trimmed }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
  return response.json() as Promise<CreateNotebookRemoteResult>
}

export async function syncNotebooks(): Promise<NotebookRow[]> {
  const response = await fetch('/api/notebooks/sync', { method: 'POST' })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
  return response.json() as Promise<NotebookRow[]>
}
