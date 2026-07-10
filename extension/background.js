// RPC IDs — keep in sync with src/server/notebooklm/notebooklm.ts
const RPC_CREATE = 'CCqFvf'
const RPC_ADD_SOURCES = 'izAoDd'
const RPC_LIST = 'wXbhsf'
const RPC_RENAME = 's0tc2d'
const RPC_DELETE = 'WWINqb'

const BASE_URL = 'https://notebooklm.google.com'
const NOTEBOOK_URL_PREFIX = `${BASE_URL}/notebook/`

const ALLOWED_ORIGIN_PREFIXES = [
  'http://localhost:',
  'http://127.0.0.1:',
]

let tokens = null

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

function extractToken(key, html) {
  const regex = new RegExp(`"${key}":"([^"]+)"`)
  const match = regex.exec(html)
  return match ? match[1] : null
}

async function getTokens() {
  const response = await fetchWithTimeout(BASE_URL, {
    credentials: 'include',
    redirect: 'manual',
  })

  if (!response.ok && response.type !== 'opaqueredirect') {
    throw new Error('Failed to fetch NotebookLM page')
  }

  const html = await response.text()
  const bl = extractToken('cfb2h', html)
  const at = extractToken('SNlM0e', html)

  if (!bl || !at) {
    throw new Error('Not authorized. Please login to NotebookLM first.')
  }

  tokens = { bl, at }
  return tokens
}

async function rpc(rpcId, params, sourcePath = '/') {
  if (!tokens) {
    await getTokens()
  }

  const url = new URL(`${BASE_URL}/_/LabsTailwindUi/data/batchexecute`)
  const reqId = Math.floor(Math.random() * 900000 + 100000).toString()

  url.searchParams.set('rpcids', rpcId)
  url.searchParams.set('source-path', sourcePath)
  url.searchParams.set('bl', tokens.bl)
  url.searchParams.set('_reqid', reqId)
  url.searchParams.set('rt', 'c')

  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[rpcId, JSON.stringify(params), null, 'generic']]]),
    at: tokens.at,
  })

  const response = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    credentials: 'include',
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`RPC call failed: ${response.status}`)
  }

  return response.text()
}

function parseBatchexecuteResponse(responseText) {
  const body = responseText.startsWith(")]}'") ? responseText.slice(4) : responseText
  const lines = body.trim().split('\n')
  const results = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue

    if (/^\d+$/.test(line)) {
      const next = lines[i + 1]?.trim()
      if (next) {
        try {
          results.push(JSON.parse(next))
        } catch {
          // skip malformed chunk
        }
        i += 1
      }
      continue
    }

    try {
      results.push(JSON.parse(line))
    } catch {
      // skip non-json lines
    }
  }

  return results
}

function extractRpcResult(parsed, rpcId) {
  for (const chunk of parsed) {
    if (!Array.isArray(chunk)) continue
    for (const item of chunk) {
      if (!Array.isArray(item) || item.length < 3) continue
      if (item[0] !== 'wrb.fr' || item[1] !== rpcId) continue
      const result = item[2]
      if (typeof result === 'string') {
        return JSON.parse(result)
      }
      return result
    }
  }
  return null
}

function parseTimestamp(tsArray) {
  if (!Array.isArray(tsArray) || tsArray.length < 1) return null
  const seconds = tsArray[0]
  if (typeof seconds !== 'number') return null
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function parseSourceCount(row) {
  if (!Array.isArray(row[1])) return 0

  let count = 0
  for (const source of row[1]) {
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

function parseNotebookList(result) {
  if (!Array.isArray(result)) return []

  const rows = Array.isArray(result[0]) ? result[0] : result
  const notebooks = []

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue
    const title = typeof row[0] === 'string' ? row[0] : 'Untitled'
    const notebooklmId = typeof row[2] === 'string' ? row[2] : null
    if (!notebooklmId) continue

    let created_at = null
    let last_viewed = null
    if (row.length > 5 && Array.isArray(row[5]) && row[5].length > 0) {
      const metadata = row[5]
      if (metadata.length > 5) last_viewed = parseTimestamp(metadata[5])
      if (metadata.length > 8) created_at = parseTimestamp(metadata[8])
    }

    const source_count = parseSourceCount(row)

    notebooks.push({
      notebooklmId,
      title,
      url: `${NOTEBOOK_URL_PREFIX}${notebooklmId}`,
      created_at,
      last_viewed,
      source_count,
    })
  }

  return notebooks
}

async function renameNotebook(notebooklmId, title) {
  tokens = null
  await getTokens()
  await rpc(
    RPC_RENAME,
    [notebooklmId, [[null, null, null, [null, title]]]],
    `/notebook/${notebooklmId}`,
  )
  return { success: true }
}

async function deleteNotebook(notebooklmId) {
  tokens = null
  await getTokens()
  await rpc(RPC_DELETE, [[notebooklmId], [2]])
  return { success: true }
}

async function listNotebooks() {
  tokens = null
  await getTokens()
  const text = await rpc(RPC_LIST, [null, 1, null, [2]])
  const result = extractRpcResult(parseBatchexecuteResponse(text), RPC_LIST)
  if (result == null) {
    throw new Error('NotebookLM returned no notebooks')
  }
  return {
    success: true,
    notebooks: parseNotebookList(result),
  }
}

async function createNotebook(title) {
  const response = await rpc(RPC_CREATE, [title])
  const uuidMatch = response.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  )
  if (!uuidMatch) {
    throw new Error('Failed to create notebook')
  }
  return uuidMatch[0]
}

async function addYouTubeSource(notebookId, url) {
  const source = [null, null, null, null, null, null, null, [url]]
  await rpc(RPC_ADD_SOURCES, [[source], notebookId], `/notebook/${notebookId}`)
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix))
}

async function createAndImport(title, url) {
  tokens = null
  await getTokens()
  const notebookId = await createNotebook(title)
  await addYouTubeSource(notebookId, url)
  return {
    success: true,
    notebookId,
    notebookUrl: `${NOTEBOOK_URL_PREFIX}${notebookId}`,
  }
}

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (!sender.origin || !isAllowedOrigin(sender.origin)) {
    sendResponse({ error: 'Origin not allowed' })
    return
  }

  if (request.cmd === 'list-notebooks') {
    listNotebooks()
      .then(sendResponse)
      .catch((error) => {
        console.error('list-notebooks error:', error)
        sendResponse({ error: error.message })
      })
    return true
  }

  if (request.cmd === 'rename-notebook') {
    const { notebooklmId, title } = request
    if (!notebooklmId || !title) {
      sendResponse({ error: 'notebooklmId and title are required' })
      return
    }
    renameNotebook(notebooklmId, title)
      .then(sendResponse)
      .catch((error) => {
        console.error('rename-notebook error:', error)
        sendResponse({ error: error.message })
      })
    return true
  }

  if (request.cmd === 'delete-notebook') {
    const { notebooklmId } = request
    if (!notebooklmId) {
      sendResponse({ error: 'notebooklmId is required' })
      return
    }
    deleteNotebook(notebooklmId)
      .then(sendResponse)
      .catch((error) => {
        console.error('delete-notebook error:', error)
        sendResponse({ error: error.message })
      })
    return true
  }

  if (request.cmd === 'create-notebook') {
    const title = request.title ?? 'Untitled notebook'
    tokens = null
    createNotebook(title)
      .then((notebookId) => {
        sendResponse({
          success: true,
          notebooklmId: notebookId,
          notebookUrl: `${NOTEBOOK_URL_PREFIX}${notebookId}`,
          title,
        })
      })
      .catch((error) => {
        console.error('create-notebook error:', error)
        sendResponse({ error: error.message })
      })
    return true
  }

  if (request.cmd !== 'create-and-import') {
    sendResponse({ error: `Unknown command: ${request.cmd}` })
    return
  }

  const { title, url } = request
  if (!title || !url) {
    sendResponse({ error: 'title and url are required' })
    return
  }

  createAndImport(title, url)
    .then(sendResponse)
    .catch((error) => {
      console.error('create-and-import error:', error)
      sendResponse({ error: error.message })
    })

  return true
})
