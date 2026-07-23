export type AppSettings = {
  obsidianVault: string
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch('/api/settings')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `GET /api/settings failed (${res.status})`)
  }
  return res.json() as Promise<AppSettings>
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = (await res.json().catch(() => ({}))) as AppSettings & { error?: string }
  if (!res.ok) {
    throw new Error(body.error ?? `PUT /api/settings failed (${res.status})`)
  }
  return body
}
