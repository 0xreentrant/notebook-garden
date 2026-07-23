export type Theme = 'light' | 'dark'

const THEME_KEY = 'notebook-garden:theme'
const VAULT_KEY = 'notebook-garden:obsidian-vault'

export function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

export function writeTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function readObsidianVault(): string {
  return localStorage.getItem(VAULT_KEY)?.trim() ?? ''
}

export function writeObsidianVault(vaultPath: string) {
  const next = vaultPath.trim()
  if (next) localStorage.setItem(VAULT_KEY, next)
  else localStorage.removeItem(VAULT_KEY)
}

export function workspaceSwitchDirective(vaultPath = readObsidianVault()): string | null {
  const vault = vaultPath.trim()
  if (!vault) return null
  return `Switch the workspace to the ${vault}.`
}

export function withWorkspaceSwitch(lines: string[], vaultPath?: string): string {
  const directive = workspaceSwitchDirective(vaultPath ?? readObsidianVault())
  return (directive ? [directive, ...lines] : lines).join('\n')
}
