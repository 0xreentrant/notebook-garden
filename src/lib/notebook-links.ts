export type NotebookLink = {
  url: string
  title: string
}

export const NOTEBOOK_TITLE_UI_MAX = 25

export function truncateNotebookTitle(
  title: string,
  max = NOTEBOOK_TITLE_UI_MAX,
): string {
  if (title.length <= max) return title
  return `${title.slice(0, max)}…`
}

export function parseNotebookLinks(value: string | null | undefined): NotebookLink[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    const links: NotebookLink[] = []
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as NotebookLink).url === 'string' &&
        (item as NotebookLink).url.startsWith('http') &&
        typeof (item as NotebookLink).title === 'string'
      ) {
        const url = (item as NotebookLink).url.trim()
        const title = (item as NotebookLink).title.trim() || 'NotebookLM'
        if (!links.some((link) => link.url === url)) {
          links.push({ url, title })
        }
      }
    }
    return links
  } catch {
    return []
  }
}

export function serializeNotebookLinks(links: NotebookLink[]): string {
  return JSON.stringify(links)
}

export function appendNotebookLink(
  existing: NotebookLink[],
  link: NotebookLink,
): NotebookLink[] {
  const url = link.url.trim()
  const title = link.title.trim() || 'NotebookLM'
  const index = existing.findIndex((item) => item.url === url)
  if (index === -1) return [...existing, { url, title }]
  const next = [...existing]
  next[index] = { url, title }
  return next
}
