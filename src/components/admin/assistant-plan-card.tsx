'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ClipboardCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApplyResult, ChangePlan } from '@/lib/assistant-plan'

/**
 * A change the assistant prepared, shown in full before anything happens.
 * Apply sends only ids; the server re-checks every one of them.
 */
export function PlanCard({ plan }: { plan: ChangePlan }) {
  const router = useRouter()
  const [state, setState] = useState<'ready' | 'applying' | 'done' | 'discarded'>('ready')
  const [results, setResults] = useState<ApplyResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const total = plan.stores.length + plan.supervisors.length
  const failed = results.filter((r) => !r.ok)

  async function apply() {
    setState('applying')
    setError(null)
    try {
      const res = await fetch('/api/admin/ask/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stores: plan.stores.map(({ user_id, mode, outlet_ids }) => ({ user_id, mode, outlet_ids })),
          supervisors: plan.supervisors.map(({ user_id, supervisor_id }) => ({
            user_id,
            supervisor_id,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        results?: ApplyResult[]
        error?: string
      }
      if (!res.ok || !json.results) throw new Error(json.error ?? 'The changes could not be applied.')
      setResults(json.results)
      setState('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The changes could not be applied.')
      setState('ready')
    }
  }

  return (
    <div className="mt-3 whitespace-normal rounded-xl border border-border bg-background p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck className="h-4 w-4 shrink-0 text-brand" />
        {total} change{total === 1 ? '' : 's'} to review
      </p>

      {plan.stores.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Store allocations
          </p>
          <ul className="mt-1 max-h-72 divide-y divide-border overflow-y-auto">
            {plan.stores.map((row) => (
              <li key={row.user_id} className="py-2 text-sm">
                <span className="font-medium">{row.user_name}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  {row.mode === 'replace' ? 'only these stores' : 'add to their stores'}
                </span>
                <span className="block">{row.outlet_names.join(', ') || 'no stores'}</span>
                {row.current_names.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Now: {row.current_names.join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.supervisors.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Supervisors
          </p>
          <ul className="mt-1 max-h-72 divide-y divide-border overflow-y-auto">
            {plan.supervisors.map((row) => (
              <li key={row.user_id} className="py-2 text-sm">
                <span className="font-medium">{row.user_name}</span>
                {' → '}
                {row.supervisor_name ?? 'no supervisor'}
                {row.current_name && row.current_name !== row.supervisor_name && (
                  <span className="block text-xs text-muted-foreground">Now: {row.current_name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.unmatched.length > 0 && (
        <div className="mt-3 rounded-lg bg-warning/10 p-2 text-xs">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" />
            Left out, could not be matched
          </p>
          <ul className="mt-1 list-disc pl-5">
            {plan.unmatched.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-xs font-medium text-destructive">{error}</p>}

      {state === 'done' ? (
        <div className="mt-3 space-y-1 text-xs">
          <p className="font-semibold">
            {results.length - failed.length} of {results.length} applied.
          </p>
          {failed.map((r, i) => (
            <p key={i} className="flex items-start gap-1.5 text-destructive">
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {r.name}: {r.detail}
            </p>
          ))}
          {failed.length === 0 && (
            <p className="flex items-center gap-1.5 text-success">
              <Check className="h-3.5 w-3.5" /> Everything was saved.
            </p>
          )}
        </div>
      ) : state === 'discarded' ? (
        <p className="mt-3 text-xs text-muted-foreground">Discarded. Nothing was changed.</p>
      ) : (
        <div className={cn('mt-3 flex flex-wrap gap-2')}>
          <Button size="sm" onClick={apply} disabled={state === 'applying'}>
            <Check className="h-4 w-4" />
            {state === 'applying' ? 'Applying…' : `Apply ${total} change${total === 1 ? '' : 's'}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setState('discarded')}
            disabled={state === 'applying'}
          >
            Discard
          </Button>
        </div>
      )}
    </div>
  )
}
