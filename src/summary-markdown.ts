const TIMESTAMP = /\d{1,2}:\d{2}(?::\d{2})?/g
const MARKDOWN_LINK = /\[[^\]]*\]\([^)]*\)/g

/** Strip legacy 3–4 space indent from batch formatter / markdown import. */
export function prepareSummaryMarkdown(text: string, videoUrl?: string): string {
  const lines = text.split('\n').map((line) =>
    line.startsWith('   ') ? line.replace(/^ {3,4}/, '') : line,
  )
  const out: string[] = []
  for (const line of lines) {
    const normalized = normalizeBoldHeading(line)
    if (/^\*\*A:\*\*/.test(normalized.trim()) && out.length > 0 && out[out.length - 1]?.trim() !== '') {
      out.push('')
    }
    out.push(normalized)
  }
  const prepared = out.join('\n').trim()
  return videoUrl ? linkVideoTimestamps(prepared, videoUrl) : prepared
}

export function timestampToSeconds(value: string): number {
  const parts = value.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

export function videoTimeUrl(videoUrl: string, seconds: number): string {
  const url = new URL(videoUrl)
  url.searchParams.set('t', String(seconds))
  return url.toString()
}

export function linkVideoTimestamps(text: string, videoUrl: string): string {
  let result = ''
  let lastIndex = 0
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const index = match.index ?? 0
    result += linkTimestampsInPlain(text.slice(lastIndex, index), videoUrl)
    result += match[0]
    lastIndex = index + match[0].length
  }
  return result + linkTimestampsInPlain(text.slice(lastIndex), videoUrl)
}

function linkTimestampsInPlain(text: string, videoUrl: string): string {
  return text.replace(TIMESTAMP, (match) => {
    const seconds = timestampToSeconds(match)
    return `[${match}](${videoTimeUrl(videoUrl, seconds)})`
  })
}

function normalizeBoldHeading(line: string): string {
  const match = line.trim().match(/^\*\*(.+?):\*\*$/)
  if (!match) return line
  const label = match[1]
  if (label === 'Q' || label === 'A') return line
  return `### ${label}`
}
