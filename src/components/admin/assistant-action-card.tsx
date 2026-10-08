'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, Check, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ActionResult, PageLink, ProposedAction } from '@/lib/assistant-action-types'

/**
 * Something Ask Xtend offers to do, shown in full first. Nothing happens
 * until the button is pressed; the server then runs it through the same
 * route as the dashboard's own button.
 */
export function ActionCard({ action }: { action: ProposedAction }) {
  const router = useRouter()
  const [state, setState] = useState<'ready' | 'working' | 'done' | 'discarded'>('ready')
  const [result, setResult] = useState<ActionResult | null>(null)

  async function apply() {
    setState('working')
    setResult(null)
    try {
      const res = await fetch('/api/admin/ask/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: action.kind, payload: action.payload }),
      })
      const json = (await res.json().catch(() => ({}))) as Partial<ActionResult> & { error?: string }
      const r: ActionResult = { ok: res.ok && json.ok !== false, detail: json.detail ?? json.error ?? 'It could not be done.' }
      setResult(r)
      setState(r.ok ? 'done' : 'ready')
      if (r.ok) router.refresh()
    } catch {
      setResult({ ok: false, detail: 'No connection. Try again.' })
      setState('ready')
    }
  }

  return (
    <div className="mt-3 whitespace-normal rounded-xl border border-border bg-background p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Wand2 className="h-4 w-4 shrink-0 text-brand" />
        {action.title}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {action.lines.map((line, i) => (
          <li key={i} className="break-words">
            {line}
          </li>
        ))}
      </ul>
      {action.warning && state !== 'done' && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {action.warning}
        </p>
      )}

      {result && (
        <p className={`mt-2 flex items-start gap-1.5 text-xs font-medium ${result.ok ? 'text-success' : 'text-destructive'}`}>
          {result.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {result.detail}
        </p>
      )}

      {state === 'discarded' ? (
        <p className="mt-3 text-xs text-muted-foreground">Cancelled. Nothing was done.</p>
      ) : state !== 'done' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={apply} disabled={state === 'working'}>
            <Check className="h-4 w-4" />
            {state === 'working' ? 'Working…' : action.verb}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState('discarded')} disabled={state === 'working'}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function PageLinks({ links }: { links: PageLink[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 whitespace-normal">
      {links.map((l, i) => (
        <Link
          key={i}
          href={l.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:border-brand hover:bg-tint"
        >
          {l.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ))}
    </div>
  )
}
