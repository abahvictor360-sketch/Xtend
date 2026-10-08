import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  RISK_LABEL,
  SEVERITY_LABEL,
  integrityQueryString,
  kindLabel,
  type DayCount,
  type IntegrityFilter,
  type RiskPerson,
} from '@/lib/integrity-review'
import { cn, longDate } from '@/lib/utils'

/* The Integrity page's overview: the numbers, who to look at first, flags per day and by check. */

export const SEV_COLOUR = { high: '#9b3517', medium: '#d1511a', low: '#f2b48a' } as const
const LEVEL_BADGE = { act: 'destructive', watch: 'warning', note: 'outline' } as const

export function Stat({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: 'warn' | 'bad' }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-4">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums',
            tone === 'warn' && 'text-warning',
            tone === 'bad' && 'text-destructive',
          )}
        >
          {value}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  )
}

export function RiskList({ risk, filter }: { risk: RiskPerson[]; filter: IntegrityFilter }) {
  return (
    <ol className="divide-y divide-border">
      {risk.map((p, i) => {
        const who = `person=${p.user_id}&date=${p.lastDate}`
        return (
          <li key={p.user_id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="font-semibold">{p.name}</span>
              <Badge variant={LEVEL_BADGE[p.level]}>{RISK_LABEL[p.level]}</Badge>
              <span className="ml-auto flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                {p.high > 0 && <SevCount n={p.high} sev="high" />}
                {p.medium > 0 && <SevCount n={p.medium} sev="medium" />}
                {p.low > 0 && <SevCount n={p.low} sev="low" />}
              </span>
            </div>
            <p className="pl-7 text-sm">{p.reason}</p>
            <div className="flex flex-wrap gap-1.5 pl-7 text-xs">
              <Link
                href={`?${integrityQueryString({ ...filter, person: p.user_id, status: 'open' })}`}
                className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                Their {p.open} flag{p.open === 1 ? '' : 's'}
              </Link>
              <Link
                href={`/admin/tracking?${who}`}
                className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                Movement {p.lastDate.slice(5)}
              </Link>
              <Link
                href={`/admin/excuses?${who}`}
                className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                Check an excuse
              </Link>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function SevCount({ n, sev }: { n: number; sev: keyof typeof SEV_COLOUR }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5" title={`${n} ${SEVERITY_LABEL[sev].toLowerCase()}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOUR[sev] }} />
      {n}
    </span>
  )
}

/** Stacked bars, one per day: high at the bottom, then medium, then low. */
export function Trend({ days }: { days: DayCount[] }) {
  const max = Math.max(1, ...days.map((d) => d.total))
  const totals = { high: 0, medium: 0, low: 0 }
  for (const d of days) {
    totals.high += d.high
    totals.medium += d.medium
    totals.low += d.low
  }
  const busiest = days.reduce((a, b) => (b.total > a.total ? b : a), days[0])
  return (
    <div className="space-y-2">
      <div className="flex h-28 items-end gap-px rounded-md bg-[#f6e4d8]/50 p-1" role="img" aria-label="Flags per day">
        {days.map((d) => (
          <div
            key={d.date}
            className="flex h-full min-w-0 flex-1 flex-col-reverse"
            title={`${longDate(d.date)}: ${d.total} flag${d.total === 1 ? '' : 's'} (${d.high} high, ${d.medium} medium, ${d.low} low)`}
          >
            {(['high', 'medium', 'low'] as const).map((s) =>
              d[s] > 0 ? <div key={s} style={{ height: `${(d[s] / max) * 100}%`, background: SEV_COLOUR[s] }} /> : null,
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{days[0]?.date.slice(5)}</span>
        {days.length > 2 && <span>{days[Math.floor(days.length / 2)].date.slice(5)}</span>}
        <span>{days.at(-1)?.date.slice(5)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {(['high', 'medium', 'low'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEV_COLOUR[s] }} />
            {SEVERITY_LABEL[s]} <span className="font-semibold tabular-nums">{totals[s]}</span>
          </span>
        ))}
        {busiest && busiest.total > 0 && (
          <span className="text-muted-foreground">Busiest: {longDate(busiest.date)} ({busiest.total})</span>
        )}
      </div>
    </div>
  )
}

export function KindBars({
  kinds,
  active,
  href,
}: {
  kinds: { key: string; total: number; open: number }[]
  active: string | null
  href: (kind: string | null) => string
}) {
  const most = kinds[0]?.total ?? 1
  return (
    <ul className="space-y-2 text-sm">
      {kinds.slice(0, 10).map((k) => (
        <li key={k.key}>
          <Link href={href(active === k.key ? null : k.key)} className="group block">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn('truncate group-hover:underline', active === k.key && 'font-semibold text-brand')}>
                {kindLabel(k.key)}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {k.open} open · {k.total}
              </span>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-[#f6e4d8]">
              <span className="block h-full rounded-full bg-[#d1511a]" style={{ width: `${Math.max(4, (k.total / most) * 100)}%` }} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
