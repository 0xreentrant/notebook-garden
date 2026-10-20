import {
  type SelectedResource,
} from '@/hooks/useTabSelection'
import { saveConnectorNotebookUrl } from '@/notebooklm-importer'

function resourcePath(resource: SelectedResource) {
  const path = {
    youtube: `/api/entries/${resource.id}`,
    bookmarks: `/api/bookmarks/${resource.id}`,
    linkedin: `/api/linkedin-saved/${resource.id}`,
    reddit: `/api/reddit-saved/${resource.id}`,
  }[resource.connector]
  return path
}

export async function readConnectorNotebookUrl(resource: SelectedResource) {
  const response = await fetch(resourcePath(resource))
  if (!response.ok) return null
  const row = await response.json() as { notebooklm_url?: string | null }
  return row.notebooklm_url ?? null
}

export async function notebookLinkBaseline(resources: SelectedResource[]) {
  const baseline = new Map<string, string | null>()
  for (const resource of resources) {
    baseline.set(resource.key, await readConnectorNotebookUrl(resource))
  }
  return baseline
}

export async function linkConnectorResources(input: {
  resources: SelectedResource[]
  urls: string[]
  notebookUrl: string
  title: string
  baseline: Map<string, string | null>
}) {
  const included = input.resources.filter((resource) => input.urls.includes(resource.url))
  const linked: { resource: SelectedResource; row: unknown }[] = []
  for (const resource of included) {
    const current = await readConnectorNotebookUrl(resource)
    if (current !== (input.baseline.get(resource.key) ?? null)) continue
    const row = await saveConnectorNotebookUrl(
      resource.connector,
      resource.id,
      input.notebookUrl,
      input.title,
    )
    linked.push({ resource, row })
  }
  return linked
}
