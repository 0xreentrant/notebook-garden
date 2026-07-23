import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readObsidianVault,
  readTheme,
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
