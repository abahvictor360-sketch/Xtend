'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PolicyText, ScoringSummary, type XmPolicy } from '@/components/metrics/policy'
import { bandVariant, fmtScore, monthLabel, type XmGrade, type XmSettings } from '@/lib/metrics/shared'

/** "Mark as read" for the current policy version. */
export function PolicyReadButton({ policyId }: { policyId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const res = await fetch('/api/metrics/policy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ policy_id: policyId }),
            })
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Try again')
            router.refresh()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Try again')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} I have read this
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** The person's own score this month, the rules, and the written policy. */
export function XmMyScore({
  grade,
  settings,
  policy,
  read,
}: {
  grade: XmGrade | null
  settings: XmSettings | null
  policy: XmPolicy | null
  read: boolean
}) {
  const factors = grade
    ? ([
        ['Sales against target', grade.sales.score, grade.weights.sales,
          grade.sales.target
            ? `${grade.sales.target_kind === 'store' ? `Your stores sold ${grade.sales.store_units_sold ?? 0}` : `You sold ${grade.sales.units_sold}`} of ${grade.sales.target}`
            : 'No target set yet'],
        ['Stock accuracy', grade.accuracy.score, grade.weights.accuracy,
          `${grade.accuracy.within_tolerance} of ${grade.accuracy.reconciliations} counts matched`],
        ['Reporting consistency', grade.consistency.score, grade.weights.consistency,
          `${grade.consistency.days_present} days worked: sales on time ${grade.consistency.sales_on_time}, counts up to date ${grade.consistency.counts_in_time}`],
        ['Expiry handling', grade.expiry.score, grade.weights.expiry,
          `${grade.expiry.expiry_recorded} of ${grade.expiry.lines_counted} batches dated, ${grade.expiry.expired_on_shelf} expired on shelf`],
      ] as const)
    : []

  return (
    <div className="space-y-4">
      {grade && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your score, {monthLabel(grade.month)}
              </p>
              <p className="text-3xl font-bold">{fmtScore(grade.score)}</p>
            </div>
            <Badge variant={bandVariant(grade.band)}>{grade.band ?? 'Not scored yet'}</Badge>
          </div>
          <ul className="divide-y divide-border text-sm">
            {factors.map(([label, score, weight, detail]) => (
              <li key={label} className="py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{label}</span>
                  <span>
                    {fmtScore(score)} <span className="text-xs text-muted-foreground">× {weight}</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{score === null ? 'Nothing to score yet this month' : detail}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            It changes as you send counts and sales. Up to yesterday; the office finalises it after the month ends.
          </p>
        </section>
      )}

      {settings && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">How the score is worked out</p>
          <ScoringSummary settings={settings} />
        </section>
      )}

      {policy && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div>
            <p className="text-base font-bold">{policy.title}</p>
            <p className="text-xs text-muted-foreground">
              Updated {new Date(policy.published_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium' })}
              {policy.change_note ? ` · ${policy.change_note}` : ''}
            </p>
          </div>
          <PolicyText body={policy.body} />
          {read ? (
            <Alert variant="success">You have read this version.</Alert>
          ) : (
            <PolicyReadButton policyId={policy.id} />
          )}
        </section>
      )}
    </div>
  )
}
