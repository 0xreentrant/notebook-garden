import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type ChromeBookmarkFlat = {
  url: string
  title: string
  folder_path: string
  chrome_profile: string
  date_added: string | null
}

type ChromeNode = {
  type?: string
  name?: string
  url?: string
  date_added?: string
  children?: ChromeNode[]
}

// Chrome stores date_added as WebKit time: microseconds since 1601-01-01 UTC
const WEBKIT_TO_UNIX_MS = 11644473600000

export function chromeTimeToIso(raw: string | undefined): string | null {
  const us = Number(raw)
  if (!Number.isFinite(us) || us <= 0) return null
  const ms = us / 1000 - WEBKIT_TO_UNIX_MS
  if (ms <= 0) return null
  return new Date(ms).toISOString()
}

type ChromeBookmarksFile = {
  roots?: {
    bookmark_bar?: ChromeNode
    other?: ChromeNode
    synced?: ChromeNode
  }
}

const SKIP_PROFILES = new Set(['Guest Profile', 'System Profile'])

export function defaultChromeUserDataDir() {
  return path.join(homedir(), '.config', 'google-chrome')
}

export function readChromeProfileDisplayNames(userDataDir = defaultChromeUserDataDir()) {
  const localStatePath = path.join(userDataDir, 'Local State')
  if (!existsSync(localStatePath)) return new Map<string, string>()

  try {
    const data = JSON.parse(readFileSync(localStatePath, 'utf8')) as {
      profile?: { info_cache?: Record<string, { name?: string }> }
    }
    const cache = data.profile?.info_cache ?? {}
    const names = new Map<string, string>()
    for (const [dir, info] of Object.entries(cache)) {
      const name = typeof info?.name === 'string' ? info.name.trim() : ''
      if (name) names.set(dir, name)
    }
    return names
  } catch {
    return new Map<string, string>()
  }
}

export function discoverChromeBookmarkFiles(userDataDir = defaultChromeUserDataDir()) {
  if (!existsSync(userDataDir)) return [] as { profile: string; filePath: string }[]

  const displayNames = readChromeProfileDisplayNames(userDataDir)

  return readdirSync(userDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIP_PROFILES.has(entry.name))
    .map((entry) => ({
      profile: displayNames.get(entry.name) ?? entry.name,
      filePath: path.join(userDataDir, entry.name, 'Bookmarks'),
    }))
    .filter(({ filePath }) => existsSync(filePath))
}

function walkNode(
  node: ChromeNode | undefined,
  folderPath: string,
  profile: string,
  out: ChromeBookmarkFlat[],
) {
  if (!node) return

  if (node.type === 'url' && typeof node.url === 'string') {
    if (node.url.startsWith('javascript:')) return
    out.push({
      url: node.url,
      title: typeof node.name === 'string' && node.name.trim() ? node.name : node.url,
      folder_path: folderPath,
      chrome_profile: profile,
      date_added: chromeTimeToIso(node.date_added),
    })
    return
  }

  if (node.type === 'folder' || Array.isArray(node.children)) {
    const name = typeof node.name === 'string' ? node.name : ''
    const nextPath = folderPath
      ? name
        ? `${folderPath}/${name}`
        : folderPath
      : name
    for (const child of node.children ?? []) {
      walkNode(child, nextPath, profile, out)
    }
  }
}

export function parseChromeBookmarksFile(
  contents: string,
  profile: string,
): ChromeBookmarkFlat[] {
  const data = JSON.parse(contents) as ChromeBookmarksFile
  const out: ChromeBookmarkFlat[] = []
  const roots = data.roots ?? {}
  walkNode(roots.bookmark_bar, '', profile, out)
  walkNode(roots.other, '', profile, out)
  walkNode(roots.synced, '', profile, out)
  return out
}

export function collectChromeBookmarks(userDataDir = defaultChromeUserDataDir()) {
  const files = discoverChromeBookmarkFiles(userDataDir)
  const byUrl = new Map<string, ChromeBookmarkFlat>()
  const profiles: string[] = []

  for (const { profile, filePath } of files) {
    profiles.push(profile)
    const flat = parseChromeBookmarksFile(readFileSync(filePath, 'utf8'), profile)
    for (const bookmark of flat) {
      if (!byUrl.has(bookmark.url)) {
        byUrl.set(bookmark.url, bookmark)
      }
    }
  }

  return {
    bookmarks: [...byUrl.values()],
    profiles,
  }
}
