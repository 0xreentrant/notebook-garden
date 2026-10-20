// Matches NOTEBOOKLM_SOURCE_CAP in src/server/notebooklm/notebook-merge.ts.
export const NOTEBOOK_SOURCE_CAP = 50

export type SourceResource = {
  id: number
  title: string
  url: string
  key?: string
}

export type SourceChecklistChoice = {
  key: string
  id: number
  title: string
  url: string
  role: 'add' | 'duplicate'
}

export type SourceAddPlan = {
  action: 'add'
  urls: string[]
  projected: number
  cap: number
  destinationSourceCount: number
}

export type SourceChecklistPlan = {
  action: 'checklist'
  choices: SourceChecklistChoice[]
  projected: number
  cap: number
  destinationSourceCount: number
}

export type SourcePlan = SourceAddPlan | SourceChecklistPlan

function sourceKey(url: string) {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search}`
  } catch {
    return trimmed
  }
}

export function planResourceSources(input: {
  destinationSourceCount: number
  resources: SourceResource[]
  cap?: number
}): SourcePlan {
  const cap = input.cap ?? NOTEBOOK_SOURCE_CAP
  const seen = new Set<string>()
  const choices: SourceChecklistChoice[] = []
  const urls: string[] = []

  for (const resource of input.resources) {
    const key = sourceKey(resource.url)
    const duplicate = seen.has(key)
    if (!duplicate) {
      seen.add(key)
      urls.push(resource.url)
    }
    choices.push({
      key: resource.key ?? String(resource.id),
      id: resource.id,
      title: resource.title,
      url: resource.url,
      role: duplicate ? 'duplicate' : 'add',
    })
  }

  const projected = input.destinationSourceCount + urls.length
  if (projected <= cap) {
    return {
      action: 'add',
      urls,
      projected,
      cap,
      destinationSourceCount: input.destinationSourceCount,
    }
  }

  return {
    action: 'checklist',
    choices,
    projected,
    cap,
    destinationSourceCount: input.destinationSourceCount,
  }
}

export function urlsFromChecklist(
  plan: SourceChecklistPlan,
  includedKeys: ReadonlySet<string>,
) {
  const urls = plan.choices.flatMap((choice) =>
    choice.role === 'add' && includedKeys.has(choice.key) ? [choice.url] : [],
  )
  const projected = plan.destinationSourceCount + urls.length
  return {
    urls,
    projected,
    withinCap: urls.length > 0 && projected <= plan.cap,
  }
}
