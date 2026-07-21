import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2Icon, MessageSquareIcon, SparklesIcon } from 'lucide-react'
import {
  fetchMetaAnalysis,
  generateMetaAnalysis,
  type MetaAnalysisResponse,
} from '@/api/meta-analysis'
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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function cursorMetaAnalysisDeeplink(id: number) {
  const prompt = [
    `I want to chat about an interest meta-analysis stored in summaries.db (SQLite, workspace root).`,
    `First fetch it: sqlite3 summaries.db "SELECT id, content, created_at FROM meta_analyses WHERE id = ${id}"`,
    `Read the content, give me a brief recap of the current interests and how desires/needs evolved, then answer my follow-up questions using that analysis as context.`,
  ].join('\n')
  return `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`
}

const POLL_MS = 5000

export default function MetaAnalysisModal({ open, onOpenChange }: Props) {
  const [state, setState] = useState<MetaAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generating = state?.generating ?? false

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchMetaAnalysis()
      .then((result) => {
        if (!cancelled) setState(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || !generating) return
    const timer = setInterval(() => {
      void fetchMetaAnalysis()
        .then(setState)
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [open, generating])

  async function runGenerate(force: boolean) {
    setError(null)
    try {
      setState(await generateMetaAnalysis(force))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const analysis = state?.analysis
  const needsGenerate = !state?.cacheHit

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,52rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="space-y-4 overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>Interest meta-analysis</DialogTitle>
            <DialogDescription>
              Current interests and how desires/needs evolved across your Watch Later
              summaries. Cached in the DB until summaries change.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading cache…
            </p>
          ) : null}

          {error || (!generating && state?.lastError) ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error ?? state?.lastError}
            </p>
          ) : null}

          {generating ? (
            <p className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Generating with cursor agent… This can take a while; safe to close or reload.
            </p>
          ) : null}

          {!loading && !generating && needsGenerate && !analysis ? (
            <p className="text-sm text-muted-foreground">
              No cached analysis for the current summaries. Generate one with cursor agent
              (same path as follow-up Q&A). This can take several minutes.
            </p>
          ) : null}

          {analysis ? (
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <p className="not-prose mb-3 text-xs text-muted-foreground">
                Generated {new Date(analysis.createdAt).toLocaleString()}
                {state?.cacheHit ? ' · cache hit' : ' · stale, summaries changed since'}
              </p>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis.content}</ReactMarkdown>
            </article>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0">
          <DialogClose>Close</DialogClose>
          {analysis ? (
            <Button
              variant="outline"
              size="sm"
              render={<a href={cursorMetaAnalysisDeeplink(analysis.id)} />}
            >
              <MessageSquareIcon />
              Chat in Cursor
            </Button>
          ) : null}
          {analysis && state?.cacheHit ? (
            <Button
              type="button"
              variant="outline"
              disabled={generating}
              onClick={() => void runGenerate(true)}
            >
              {generating ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {generating ? 'Generating…' : 'Regenerate'}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={generating || loading}
              onClick={() => void runGenerate(false)}
            >
              {generating ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SparklesIcon className="size-4" />
              )}
              {generating ? 'Generating…' : 'Generate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
