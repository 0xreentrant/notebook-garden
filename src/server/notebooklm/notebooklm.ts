// RPC IDs - keep in sync with extension/background.js
export const NOTEBOOKLM_BASE_URL = 'https://notebooklm.google.com'
export const BATCHEXECUTE_URL = `${NOTEBOOKLM_BASE_URL}/_/LabsTailwindUi/data/batchexecute`
export const NOTEBOOK_URL_PREFIX = `${NOTEBOOKLM_BASE_URL}/notebook/`

export const RPC_LIST_NOTEBOOKS = 'wXbhsf'
export const RPC_CREATE_NOTEBOOK = 'CCqFvf'
export const RPC_ADD_SOURCES = 'izAoDd'
export const RPC_RENAME_NOTEBOOK = 's0tc2d'
export const RPC_DELETE_NOTEBOOK = 'WWINqb'

export const NOTEBOOKLM_DEFAULT_TITLE = 'Untitled notebook'

const NOTEBOOKLM_UUID_RE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/

export type NotebookSummary = {
  notebooklmId: string
  title: string
  url: string
  created_at: string | null
  last_viewed: string | null
  source_count: number
}

function parseTimestamp(tsArray: unknown): string | null {
  if (!Array.isArray(tsArray) || tsArray.length < 1) return null
  const seconds = tsArray[0]
  if (typeof seconds !== 'number') return null
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function parseSourceCount(row: unknown[]): number {
  const sources = row[1]
  if (!Array.isArray(sources)) return 0

  let count = 0
  for (const source of sources) {
    if (!Array.isArray(source)) continue
    const status = source[3]
    if (Array.isArray(status) && status.length > 1 && typeof status[1] === 'number') {
      if (status[1] === 2) count += 1
      continue
    }
    count += 1
  }
  return count
}

function parseNotebookRow(row: unknown[]): NotebookSummary | null {
  const title = typeof row[0] === 'string' ? row[0] : 'Untitled'
  const notebooklmId = typeof row[2] === 'string' ? row[2] : null
  if (!notebooklmId) return null

  let created_at: string | null = null
  let last_viewed: string | null = null
  if (row.length > 5 && Array.isArray(row[5]) && row[5].length > 0) {
    const metadata = row[5]
    if (metadata.length > 5) last_viewed = parseTimestamp(metadata[5])
    if (metadata.length > 8) created_at = parseTimestamp(metadata[8])
  }

  return {
    notebooklmId,
    title,
    url: `${NOTEBOOK_URL_PREFIX}${notebooklmId}`,
    created_at,
    last_viewed,
    source_count: parseSourceCount(row),
  }
}

function extractToken(key: string, html: string): string | null {
  const match = new RegExp(`"${key}":"([^"]+)"`).exec(html)
  return match?.[1] ?? null
}

export function parseBatchexecuteResponse(responseText: string): unknown[] {
  const body = responseText.startsWith(")]}'") ? responseText.slice(4) : responseText
  const lines = body.trim().split('\n')
  const results: unknown[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue

    if (/^\d+$/.test(line)) {
      const next = lines[i + 1]?.trim()
      if (next) {
        try {
          results.push(JSON.parse(next))
        } catch {
          // ponytail: skip malformed chunk lines
        }
        i += 1
      }
      continue
    }

    try {
      results.push(JSON.parse(line))
    } catch {
      // ponytail: skip non-json lines
    }
  }

  return results
}

export function extractRpcResult(parsed: unknown[], rpcId: string): unknown {
  for (const chunk of parsed) {
    if (!Array.isArray(chunk)) continue
    for (const item of chunk) {
      if (!Array.isArray(item) || item.length < 3) continue
      if (item[0] !== 'wrb.fr' || item[1] !== rpcId) continue
      const result = item[2]
      if (typeof result === 'string') {
        return JSON.parse(result) as unknown
      }
      return result
    }
  }
  return null
}

export async function getTokens(cookie: string): Promise<{ bl: string; at: string }> {
  const response = await fetch(NOTEBOOKLM_BASE_URL, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  })

  if (!response.ok && response.status !== 302) {
    throw new Error('Failed to fetch NotebookLM page for tokens')
  }

  const html = await response.text()
  const bl = extractToken('cfb2h', html)
  const at = extractToken('SNlM0e', html)

  if (!bl || !at) {
    throw new Error('Not authorized. Set NOTEBOOKLM_COOKIE from a logged-in NotebookLM session.')
  }

  return { bl, at }
}

export async function rpcCall(
  cookie: string,
  rpcId: string,
  params: unknown,
  sourcePath = '/',
  options?: { raw?: boolean },
): Promise<unknown> {
  const { bl, at } = await getTokens(cookie)
  const url = new URL(BATCHEXECUTE_URL)

  url.searchParams.set('rpcids', rpcId)
  url.searchParams.set('source-path', sourcePath)
  url.searchParams.set('bl', bl)
  url.searchParams.set('_reqid', String(Math.floor(Math.random() * 900000 + 100000)))
  url.searchParams.set('rt', 'c')

  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[rpcId, JSON.stringify(params), null, 'generic']]]),
    at,
  })

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
    },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`NotebookLM RPC failed: HTTP ${response.status}`)
  }

  const text = await response.text()
  if (options?.raw) return text
  const parsed = parseBatchexecuteResponse(text)
  return extractRpcResult(parsed, rpcId)
}

export function extractNotebooklmId(text: string): string | null {
  return text.match(NOTEBOOKLM_UUID_RE)?.[0] ?? null
}

export function parseNotebookList(result: unknown): NotebookSummary[] {
  if (!Array.isArray(result)) return []

  const rows = Array.isArray(result[0]) ? result[0] : result
  const notebooks: NotebookSummary[] = []

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue
    const notebook = parseNotebookRow(row)
    if (notebook) notebooks.push(notebook)
  }

  return notebooks
}

export async function fetchNotebookListFromApi(cookie: string): Promise<NotebookSummary[]> {
  const result = await rpcCall(cookie, RPC_LIST_NOTEBOOKS, [null, 1, null, [2]])
  if (result == null) {
    throw new Error('NotebookLM returned no notebooks. Check NOTEBOOKLM_COOKIE.')
  }
  return parseNotebookList(result)
}

export async function renameNotebookViaApi(
  cookie: string,
  notebooklmId: string,
  title: string,
): Promise<void> {
  await rpcCall(
    cookie,
    RPC_RENAME_NOTEBOOK,
    [notebooklmId, [[null, null, null, [null, title]]]],
    `/notebook/${notebooklmId}`,
  )
}

export async function deleteNotebookViaApi(
  cookie: string,
  notebooklmId: string,
): Promise<void> {
  await rpcCall(cookie, RPC_DELETE_NOTEBOOK, [[notebooklmId], [2]])
}

export async function createNotebookViaApi(
  cookie: string,
  title = NOTEBOOKLM_DEFAULT_TITLE,
): Promise<string> {
  const text = await rpcCall(
    cookie,
    RPC_CREATE_NOTEBOOK,
    [title],
    '/',
    { raw: true },
  )
  if (typeof text !== 'string') {
    throw new Error('Failed to create notebook')
  }
  const notebooklmId = extractNotebooklmId(text)
  if (!notebooklmId) {
    throw new Error('Failed to create notebook')
  }
  return notebooklmId
}

export async function addYouTubeSourceViaApi(
  cookie: string,
  notebookId: string,
  url: string,
): Promise<void> {
  const source = [null, null, null, null, null, null, null, [url]]
  await rpcCall(cookie, RPC_ADD_SOURCES, [[source], notebookId], `/notebook/${notebookId}`)
}

export type CreateAndImportResult = {
  notebookId: string
  notebookUrl: string
}

export async function createAndImportViaApi(
  cookie: string,
  title: string,
  url: string,
): Promise<CreateAndImportResult> {
  const notebookId = await createNotebookViaApi(cookie, title)
  await addYouTubeSourceViaApi(cookie, notebookId, url)
  return {
    notebookId,
    notebookUrl: `${NOTEBOOK_URL_PREFIX}${notebookId}`,
  }
}
