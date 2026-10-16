import { Store } from 'lucide-react'
import { SectionHeader } from '@/components/field/screen'
import { minutesText, visitLines, visitTotals, type SourceVisit } from '@/lib/marketer-report'

/**
 * Today's store visits at the top of the daily report: each store, when
 * they checked in and out, and the time spent. They go into the report on
 * their own when it is saved; nothing to type.
 */
export function ReportVisits({ visits, today }: { visits: SourceVisit[]; today: string }) {
  const lines = visitLines(visits, today)
  const totals = visitTotals(visits)

  return (
    <section className="space-y-2">
      <SectionHeader
        title="Today’s store visits"
        action={
          lines.length > 0 && (
            <span className="text-xs font-semibold text-brand">{minutesText(totals.minutes)} in stores</span>
          )
        }
      />
      {lines.length === 0 ? (
        <p className="rounded-2xl bg-muted px-3 py-3 text-xs text-muted-foreground">
          No store visits yet today. Check in and out at each store from the Stores tab and they appear here.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {lines.map((v, i) => (
              <li key={`${v.inTime}-${i}`} className="surface flex items-center gap-3 p-3">
                <span className="icon-tile">
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{v.store}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    In {v.inTime} · {v.open ? <span className="font-semibold text-brand">{v.outTime.toLowerCase()}</span> : `out ${v.outTime}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">{v.minutesText}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between rounded-2xl bg-tint px-3 py-2 text-xs font-semibold text-tint-foreground">
            <span>
              {totals.visits} {totals.visits === 1 ? 'visit' : 'visits'} · {totals.stores} {totals.stores === 1 ? 'store' : 'stores'}
            </span>
            <span>Total time in stores: {minutesText(totals.minutes)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">These are added to your report when you save it.</p>
        </>
      )}
    </section>
  )
}
