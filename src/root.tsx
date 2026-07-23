import './index.css'
import { useEffect, useState } from 'react'
import {
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router'
import { BookmarkIcon, BookOpenIcon, LinkIcon, SparklesIcon, SproutIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fetchSettings } from '@/api/settings'
import MetaAnalysisModal from '@/components/MetaAnalysisModal'
import SettingsMenu from '@/components/SettingsMenu'
import { Button, buttonVariants } from '@/components/ui/button'
import { APP_TABS, type AppTabPath } from '@/lib/app-tabs'
import { writeObsidianVault } from '@/lib/settings'
import { cn } from '@/lib/utils'

const TAB_ICONS: Record<AppTabPath, LucideIcon> = {
  '/summaries': SproutIcon,
  '/bookmarks': BookmarkIcon,
  '/linkedin': LinkIcon,
  '/library': BookOpenIcon,
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>notebook-garden</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export function HydrateFallback() {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading…</div>
    </main>
  )
}

export default function Root() {
  const [metaOpen, setMetaOpen] = useState(false)

  useEffect(() => {
    void fetchSettings()
      .then((settings) => writeObsidianVault(settings.obsidianVault))
      .catch(() => {})
  }, [])

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="font-heading text-3xl font-semibold tracking-tight">
                notebook-garden
              </h1>
              <p className="text-sm text-muted-foreground">
                Plant notebooks from summarized videos and bookmarks, then tend your library.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SettingsMenu />
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Meta-analyze interests across summaries"
                onClick={() => setMetaOpen(true)}
              >
                <SparklesIcon className="size-4" />
                Interests
              </Button>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Main">
            {APP_TABS.map(({ path, label, description }) => {
              const Icon = TAB_ICONS[path]
              return (
                <NavLink
                  key={path}
                  to={path}
                  title={description}
                  className={({ isActive }) =>
                    cn(
                      buttonVariants({
                        variant: isActive ? 'default' : 'outline',
                        size: 'sm',
                      }),
                      isActive && 'shadow-sm',
                    )
                  }
                >
                  <Icon className="size-4" />
                  {label}
                </NavLink>
              )
            })}
          </nav>
        </header>

        <Outlet />
      </div>

      <MetaAnalysisModal open={metaOpen} onOpenChange={setMetaOpen} />
    </main>
  )
}
