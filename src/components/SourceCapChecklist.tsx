import { useLayoutEffect, useState } from 'react'
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
  urlsFromChecklist,
  type SourceChecklistPlan,
} from '@/lib/source-checklist'

const checkboxClassName = 'size-3.5 shrink-0 rounded border-border accent-primary'

export function SourceCapChecklist({
  plan,
  mode,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  plan: SourceChecklistPlan | null
  mode: 'new' | 'existing'
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (urls: string[]) => void
}) {
  const [included, setIncluded] = useState<Set<string>>(() => new Set())

  useLayoutEffect(() => {
    if (!plan) {
      setIncluded(new Set())
      return
    }
    setIncluded(new Set(
      plan.choices.flatMap((choice) => choice.role === 'add' ? [choice.key] : []),
    ))
  }, [plan])

  const trimmed = plan ? urlsFromChecklist(plan, included) : null

  function toggle(key: string) {
    setIncluded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const projected = trimmed?.projected ?? 0
  const cap = plan?.cap ?? 0
  const destinationSourceCount = plan?.destinationSourceCount ?? 0

  return (
    <Dialog
      open={plan != null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose sources</DialogTitle>
          <DialogDescription>
            {destinationSourceCount === 0
              ? `These sources would put ${projected} sources in a new notebook. A standard notebook holds ${cap}. Uncheck sources until it is at or under ${cap}.`
              : `These sources would put ${projected} sources in this notebook, which already has ${destinationSourceCount}. A standard notebook holds ${cap}. Uncheck sources until it is at or under ${cap}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-2">
          {plan?.choices.map((choice) => {
            const checked = choice.role === 'add' && included.has(choice.key)
            return (
              <label
                key={choice.key}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={choice.role !== 'add' || pending}
                  onChange={() => toggle(choice.key)}
                  aria-label={`Include ${choice.title}`}
                  className={`${checkboxClassName} mt-1`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{choice.title}</span>
                  {choice.role === 'duplicate' ? (
                    <span className="block text-xs text-muted-foreground">duplicate</span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <DialogClose type="button" disabled={pending}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            disabled={pending || !trimmed?.withinCap}
            onClick={() => {
              if (trimmed?.withinCap) onConfirm(trimmed.urls)
            }}
          >
            {pending
              ? mode === 'new' ? 'Creating…' : 'Adding…'
              : mode === 'new' ? 'Create notebook' : 'Add to notebook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
