import { isYouTubeUrl } from './notebooklm'

// ponytail: standard-plan cap from Gemini Notebook help (Oct 2026). Plus/Pro/Ultra are 100/300/500/600. Upgrade path: GET_USER_SETTINGS (ZwVcOc) source limit at result[0][1][2].
export const NOTEBOOKLM_SOURCE_CAP = 50

export type MergeCandidate = {
  title: string | null
  url: string | null
}

export type SkippedMergeSource = {
  title: string | null
  reason: 'no-url' | 'duplicate'
}

export type NotebookMergePlan = {
  urlsToAdd: string[]
  skipped: SkippedMergeSource[]
  projectedCount: number
  cap: number
  error: string | null
}

export type MergeChecklistItem = {
  key: string
  title: string | null
  url: string | null
  notebookTitle: string
  role: 'destination' | 'add' | 'duplicate' | 'no-url'
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null
  return trimmed
}

export function candidateFromSourceRow(row: unknown[]): MergeCandidate {
  const title = typeof row[1] === 'string' && row[1].trim() ? row[1].trim() : null
  const metadata = Array.isArray(row[2]) ? row[2] : null
  let url: string | null = null
  if (metadata) {
    const canonical = metadata[7]
    if (Array.isArray(canonical)) url = httpUrl(canonical[0])
    if (!url) {
      const youtube = metadata[5]
      if (Array.isArray(youtube)) url = httpUrl(youtube[0])
    }
  }
  return { title, url }
}

/** GET_NOTEBOOK (rLM1Ne) puts source rows at result[0][1]. */
export function sourceRowsFromGetNotebook(result: unknown): unknown[][] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return []
  const sources = result[0][1]
  if (!Array.isArray(sources)) return []
  return sources.filter((row): row is unknown[] => Array.isArray(row))
}

function youtubeVideoId(url: string): string | null {
  if (!isYouTubeUrl(url)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'youtu.be') {
    return parsed.pathname.split('/').filter(Boolean)[0] ?? null
  }
  const fromQuery = parsed.searchParams.get('v')
  if (fromQuery) return fromQuery
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') {
    return parts[1] ?? null
  }
  return null
}

function urlKey(url: string): string {
  const videoId = youtubeVideoId(url)
  if (videoId) return `yt:${videoId}`
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}${parsed.search}`
  } catch {
    return url.trim()
  }
}

export function planNotebookSourceMerge(input: {
  destinationSourceCount: number
  destinationUrls: string[]
  incoming: MergeCandidate[]
  cap?: number
}): NotebookMergePlan {
  const cap = input.cap ?? NOTEBOOKLM_SOURCE_CAP
  const seen = new Set(input.destinationUrls.map(urlKey))
  const urlsToAdd: string[] = []
  const skipped: SkippedMergeSource[] = []

  for (const source of input.incoming) {
    if (!source.url) {
      skipped.push({ title: source.title, reason: 'no-url' })
      continue
    }
    const key = urlKey(source.url)
    if (seen.has(key)) {
      skipped.push({ title: source.title, reason: 'duplicate' })
      continue
    }
    seen.add(key)
    urlsToAdd.push(source.url)
  }

  const projectedCount = input.destinationSourceCount + urlsToAdd.length
  const error = projectedCount > cap
    ? `Merge would put ${projectedCount} sources on the destination, over the ${cap} source cap.`
    : null

  return {
    urlsToAdd,
    skipped,
    projectedCount,
    cap,
    error,
  }
}

export function sourceCapExceeded(
  destinationSourceCount: number,
  urls: string[],
  cap?: number,
) {
  const plan = planNotebookSourceMerge({
    destinationSourceCount,
    destinationUrls: [],
    incoming: urls.map((url) => ({ title: null, url })),
    cap,
  })
  if (!plan.error) return null
  return `This would put ${plan.projectedCount} sources on the notebook, over the ${plan.cap} source cap.`
}

export function buildMergeChecklist(input: {
  destination: { title: string; sources: MergeCandidate[] } | null
  incoming: { title: string; sources: MergeCandidate[] }[]
}): MergeChecklistItem[] {
  const items: MergeChecklistItem[] = []
  const seen = new Set<string>()
  let seq = 0

  if (input.destination) {
    for (const source of input.destination.sources) {
      seq += 1
      if (source.url) seen.add(urlKey(source.url))
      items.push({
        key: `destination:${seq}`,
        title: source.title,
        url: source.url,
        notebookTitle: input.destination.title,
        role: 'destination',
      })
    }
  }

  for (const notebook of input.incoming) {
    for (const source of notebook.sources) {
      seq += 1
      if (!source.url) {
        items.push({
          key: `no-url:${seq}`,
          title: source.title,
          url: null,
          notebookTitle: notebook.title,
          role: 'no-url',
        })
        continue
      }
      const key = urlKey(source.url)
      if (seen.has(key)) {
        items.push({
          key: `duplicate:${seq}`,
          title: source.title,
          url: source.url,
          notebookTitle: notebook.title,
          role: 'duplicate',
        })
        continue
      }
      seen.add(key)
      items.push({
        key: `add:${key}`,
        title: source.title,
        url: source.url,
        notebookTitle: notebook.title,
        role: 'add',
      })
    }
  }

  return items
}

export function limitPlanToUrls(plan: NotebookMergePlan, urls: string[] | undefined): NotebookMergePlan {
  if (!urls) return plan
  const allowed = new Set(urls.map(urlKey))
  const urlsToAdd = plan.urlsToAdd.filter((url) => allowed.has(urlKey(url)))
  const destinationCount = plan.projectedCount - plan.urlsToAdd.length
  const projectedCount = destinationCount + urlsToAdd.length
  const error = projectedCount > plan.cap
    ? `Merge would put ${projectedCount} sources on the destination, over the ${plan.cap} source cap.`
    : null
  return {
    ...plan,
    urlsToAdd: error ? [] : urlsToAdd,
    projectedCount,
    error,
  }
}
