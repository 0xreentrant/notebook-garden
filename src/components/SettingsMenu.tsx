import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { CheckIcon, ChevronRightIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react'
import { saveSettings } from '@/api/settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  readObsidianVault,
  readTheme,
  writeObsidianVault,
  writeTheme,
  type Theme,
} from '@/lib/settings'
import { cn } from '@/lib/utils'

const menuItemClass =
  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-muted data-highlighted:text-foreground'

const menuPopupClass =
  'min-w-44 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'

export default function SettingsMenu() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === 'undefined' ? 'light' : readTheme(),
  )
  const [vaultOpen, setVaultOpen] = useState(false)
  const [vaultDraft, setVaultDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onThemeChange(next: Theme) {
    setTheme(next)
    writeTheme(next)
  }

  function openVaultDialog() {
    setVaultDraft(readObsidianVault())
    setError(null)
    setVaultOpen(true)
  }

  async function onSaveVault() {
    setSaving(true)
    setError(null)
    try {
      const saved = await saveSettings({ obsidianVault: vaultDraft })
      writeObsidianVault(saved.obsidianVault)
      setVaultOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title="Settings"
              aria-label="Settings"
            />
          }
        >
          <SettingsIcon className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="outline-none" sideOffset={6} align="end">
            <Menu.Popup className={menuPopupClass}>
              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className={cn(menuItemClass, 'justify-between')}>
                  <span className="flex items-center gap-2">
                    {theme === 'dark' ? (
                      <MoonIcon className="size-4" />
                    ) : (
                      <SunIcon className="size-4" />
                    )}
                    Theme
                  </span>
                  <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner className="outline-none" sideOffset={4} align="start">
                    <Menu.Popup className={menuPopupClass}>
                      <Menu.RadioGroup
                        value={theme}
                        onValueChange={(value) => onThemeChange(value as Theme)}
                      >
                        <Menu.RadioItem value="light" className={menuItemClass}>
                          <SunIcon className="size-4" />
                          Light
                          <Menu.RadioItemIndicator className="ml-auto">
                            <CheckIcon className="size-3.5" />
                          </Menu.RadioItemIndicator>
                        </Menu.RadioItem>
                        <Menu.RadioItem value="dark" className={menuItemClass}>
                          <MoonIcon className="size-4" />
                          Dark
                          <Menu.RadioItemIndicator className="ml-auto">
                            <CheckIcon className="size-3.5" />
                          </Menu.RadioItemIndicator>
                        </Menu.RadioItem>
                      </Menu.RadioGroup>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>

              <Menu.Item className={menuItemClass} onClick={openVaultDialog}>
                Obsidian vault…
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog open={vaultOpen} onOpenChange={setVaultOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Obsidian vault</DialogTitle>
            <DialogDescription>
              Absolute path used in Cursor chat prompts to switch workspace before answering.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Vault path</span>
            <input
              type="text"
              value={vaultDraft}
              onChange={(event) => setVaultDraft(event.target.value)}
              placeholder="/home/you/Obsidian/MyVault"
              className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <Button type="button" disabled={saving} onClick={() => void onSaveVault()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
