import fs from 'node:fs'
import path from 'node:path'
import { getDbPath } from '../db/paths'

export type AppSettings = {
  obsidianVault: string
}

export function settingsPath() {
  return path.join(path.dirname(getDbPath()), 'notebook-garden-settings.json')
}

export function getSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>
    return {
      obsidianVault: typeof raw.obsidianVault === 'string' ? raw.obsidianVault.trim() : '',
    }
  } catch {
    return { obsidianVault: '' }
  }
}

export function putSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = {
    obsidianVault:
      typeof patch.obsidianVault === 'string'
        ? patch.obsidianVault.trim()
        : getSettings().obsidianVault,
  }
  fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`)
  return next
}
