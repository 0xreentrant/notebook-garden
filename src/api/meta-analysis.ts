export type MetaAnalysisRow = {
  id: number
  content: string
  sourceFingerprint: string
  createdAt: string
}

export type MetaAnalysisResponse = {
  currentFingerprint: string
  cacheHit: boolean
  analysis: MetaAnalysisRow | null
  generating: boolean
  lastError: string | null
  liveDraft: string
  liveTools: string[]
  started?: boolean
}

export async function fetchMetaAnalysis(): Promise<MetaAnalysisResponse> {
  const res = await fetch('/api/meta-analysis')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `GET /api/meta-analysis failed (${res.status})`)
  }
  return res.json() as Promise<MetaAnalysisResponse>
}

export async function generateMetaAnalysis(force = false): Promise<MetaAnalysisResponse> {
  const res = await fetch('/api/meta-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  })
  const body = (await res.json().catch(() => ({}))) as MetaAnalysisResponse & { error?: string }
  if (!res.ok) {
    throw new Error(body.error ?? `POST /api/meta-analysis failed (${res.status})`)
  }
  return body
}
