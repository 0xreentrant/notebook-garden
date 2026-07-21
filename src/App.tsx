import { useState } from 'react'
import { BookmarkIcon, BookOpenIcon, LinkIcon, SparklesIcon, SproutIcon } from 'lucide-react'
import MetaAnalysisModal from '@/components/MetaAnalysisModal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppView } from '@/types'
import BookmarksView from '@/views/BookmarksView'
import LibraryView from '@/views/LibraryView'
import LinkedInSavedView from '@/views/LinkedInSavedView'
import SummariesView from '@/views/SummariesView'

const TABS: { id: AppView; label: string; description: string; icon: typeof SproutIcon }[] = [
  {
    id: 'summaries',
    label: 'Summaries',
    description: 'Create notebooks from YouTube summaries',
    icon: SproutIcon,
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    description: 'Create notebooks from Chrome bookmarks',
    icon: BookmarkIcon,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Saved',
    description: 'Browse captured LinkedIn Saved items',
    icon: LinkIcon,
  },
  {
    id: 'library',
    label: 'Library',
    description: 'Tend your NotebookLM garden',
    icon: BookOpenIcon,
  },
]

export default function App() {
  const [view, setView] = useState<AppView>('summaries')
  const [metaOpen, setMetaOpen] = useState(false)

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
          <nav className="flex flex-wrap gap-2" aria-label="Main">
            {TABS.map(({ id, label, description, icon: Icon }) => (
              <Button
                key={id}
                type="button"
                variant={view === id ? 'default' : 'outline'}
                size="sm"
                className={cn(view === id && 'shadow-sm')}
                aria-current={view === id ? 'page' : undefined}
                title={description}
                onClick={() => setView(id)}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            ))}
          </nav>
        </header>

        {view === 'summaries' ? (
          <SummariesView />
        ) : view === 'bookmarks' ? (
          <BookmarksView />
        ) : view === 'linkedin' ? (
          <LinkedInSavedView />
        ) : (
          <LibraryView />
        )}
      </div>

      <MetaAnalysisModal open={metaOpen} onOpenChange={setMetaOpen} />
    </main>
  )
}
