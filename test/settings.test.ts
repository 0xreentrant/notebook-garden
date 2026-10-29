import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  htmlThemeClass,
  readObsidianVault,
  readTheme,
  themeBootScript,
  withWorkspaceSwitch,
  workspaceSwitchDirective,
  writeObsidianVault,
  writeTheme,
} from '../src/lib/settings'

const store = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  },
  configurable: true,
})

const toggle = vi.fn()
Object.defineProperty(globalThis, 'document', {
  value: { documentElement: { classList: { toggle } } },
  configurable: true,
})

afterEach(() => {
  store.clear()
  toggle.mockClear()
})

describe('settings', () => {
  it('stores theme and toggles .dark on html', () => {
    expect(readTheme()).toBe('light')
    writeTheme('dark')
    expect(readTheme()).toBe('dark')
    expect(toggle).toHaveBeenCalledWith('dark', true)
    writeTheme('light')
    expect(toggle).toHaveBeenCalledWith('dark', false)
  })

  it('boot script toggles .dark the same way readTheme does', () => {
    expect(htmlThemeClass()).toBeUndefined()
    const boot = new Function(themeBootScript()) as () => void
    boot()
    expect(toggle).toHaveBeenCalledWith('dark', false)

    store.set('notebook-garden:theme', 'dark')
    expect(htmlThemeClass()).toBe('dark')
    boot()
    expect(toggle).toHaveBeenCalledWith('dark', true)
  })

  it('prepends workspace switch only when vault is set', () => {
    expect(workspaceSwitchDirective('')).toBeNull()
    expect(withWorkspaceSwitch(['hello'], '')).toBe('hello')

    writeObsidianVault('/vaults/notes')
    expect(readObsidianVault()).toBe('/vaults/notes')
    expect(workspaceSwitchDirective()).toBe('Switch the workspace to the /vaults/notes.')
    expect(withWorkspaceSwitch(['hello'])).toBe(
      'Switch the workspace to the /vaults/notes.\nhello',
    )
  })
})
