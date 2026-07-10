export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function parseTags(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(
      parsed
        .filter((tag): tag is string => typeof tag === 'string')
        .map(normalizeTag)
        .filter(Boolean),
    )].sort()
  } catch {
    return []
  }
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(
    [...new Set(tags.map(normalizeTag).filter(Boolean))].sort(),
  )
}

export function collectAllTags(entries: { tags: string[] }[]): string[] {
  const set = new Set<string>()
  for (const entry of entries) {
    for (const tag of entry.tags) set.add(tag)
  }
  return [...set].sort()
}
