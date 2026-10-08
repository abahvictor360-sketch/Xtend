'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, Boxes, ClipboardCheck, PackageCheck, ShoppingBag, Timer, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEEP, SOLD, SUPPLIED, TRACK } from '@/lib/metrics/colours'
import type { Activity, CategoryShare, Kpi, MonthBar, StoreBar } from '@/lib/metrics/dashboard'

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

const KPI_ICONS = [ShoppingBag, Truck, ClipboardCheck, Timer]

function ChangePill({ kpi, onDeep }: { kpi: Kpi; onDeep?: boolean }) {
  if (!kpi.change) return <span className={cn('text-[11px]', onDeep ? 'text-white/60' : 'text-muted-foreground')}>No change</span>
  const Icon = kpi.tone === 'down' ? ArrowDownRight : ArrowUpRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
        kpi.tone === 'down' ? 'bg-[#fde3dc] text-[#a3301a]' : kpi.tone === 'up' ? 'bg-[#dcf5cf] text-[#21570f]' : 'bg-muted text-muted-foreground',
      )}
    >
      {kpi.tone !== 'flat' && <Icon className="h-3 w-3" />}
      {kpi.change}
    </span>
  )
}

/** The four headline numbers; the first is the dark, highlighted one. */
export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k, i) => {
        const Icon = KPI_ICONS[i] ?? Boxes
        const deep = i === 0
        return (
          <div
            key={k.label}
            className={cn('rounded-3xl p-5 shadow-sm', deep ? 'text-white' : 'border border-border bg-card')}
            style={deep ? { background: DEEP } : undefined}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', deep ? 'bg-white text-[#1f5f47]' : 'text-white')}
                style={deep ? undefined : { background: [SOLD, '#1d9a8a', '#3b82c4', '#c98500'][i] }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className={cn('text-xs font-medium', deep ? 'text-white/80' : 'text-muted-foreground')}>{k.label}</p>
                <p className="mt-0.5 text-3xl font-bold tabular-nums tracking-tight">{k.value}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <ChangePill kpi={k} onDeep={deep} />
              <span className={cn('text-right text-[11px] leading-tight', deep ? 'text-white/70' : 'text-muted-foreground')}>{k.note}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sales overview: units sold and supplied, by month                   */
/* ------------------------------------------------------------------ */

function niceMax(value: number) {
  if (value <= 4) return 4
  const step = Math.pow(10, Math.floor(Math.log10(value)))
  for (const m of [1, 2, 2.5, 4, 5, 6, 8, 10]) if (m * step >= value) return m * step
  return 10 * step
}

export function SalesOverviewChart({ months }: { months: MonthBar[] }) {
  const [picked, setPicked] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...months.map((m) => Math.max(m.sold, m.supplied))))
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0]
  const fmt = (n: number) => n.toLocaleString('en-GB')
  const shown = picked ?? months.length - 1
  const m = months[shown]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOLD }} /> Units sold
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SUPPLIED }} /> Units supplied
          </span>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          <span className="font-semibold text-foreground">{m.label}</span>: {fmt(m.sold)} sold · {fmt(m.supplied)} supplied
        </p>
      </div>

      <div className="relative flex h-64 gap-3">
        <div className="flex w-10 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {fmt(Math.round(t))}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-dashed border-border" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-stretch justify-between gap-1">
            {months.map((mo, i) => {
              const on = shown === i
              return (
                <button
                  type="button"
                  key={mo.month}
                  className="group relative flex min-w-0 flex-1 flex-col items-center focus-visible:outline-none"
                  onMouseEnter={() => setPicked(i)}
                  onMouseLeave={() => setPicked(null)}
                  onFocus={() => setPicked(i)}
                  onClick={() => setPicked(i)}
                  aria-label={`${mo.label}: ${mo.sold} units sold, ${mo.supplied} units supplied`}
                >
                  <div className={cn('flex w-full flex-1 items-end justify-center gap-[3px] rounded-xl px-0.5 transition-colors', on && 'bg-[#eef6f1]')}>
                    {(
                      [
                        [mo.sold, SOLD],
                        [mo.supplied, SUPPLIED],
                      ] as const
                    ).map(([v, colour], j) => (
                      <span
                        key={j}
                        className="block w-full max-w-[14px] rounded-t-[4px]"
                        style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0, background: colour, opacity: on || picked === null ? 1 : 0.55 }}
                      />
                    ))}
                  </div>
                  <span
                    className={cn(
                      'mt-1.5 h-[18px] text-[11px]',
                      on ? 'font-semibold text-foreground' : 'text-muted-foreground',
                      // Every other month on a phone, so the names do not run together.
                      !on && i % 2 === 1 && 'invisible sm:visible',
                    )}
                  >
                    {mo.label}
                  </span>
                  {on && picked !== null && (
                    <span className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2 text-left text-xs shadow-lg">
                      <span className="block font-semibold">{mo.label}</span>
                      <span className="block text-muted-foreground">
                        <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: SOLD }} />
                        Sold <b className="text-foreground">{fmt(mo.sold)}</b>
                      </span>
                      <span className="block text-muted-foreground">
                        <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: SUPPLIED }} />
                        Supplied <b className="text-foreground">{fmt(mo.supplied)}</b>
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-medium">Month</th>
              <th className="py-1 text-right font-medium">Sold</th>
              <th className="py-1 text-right font-medium">Supplied</th>
            </tr>
          </thead>
          <tbody>
            {months.map((mo) => (
              <tr key={mo.month} className="border-t border-border">
                <td className="py-1">{new Date(`${mo.month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>
                <td className="py-1 text-right tabular-nums">{fmt(mo.sold)}</td>
                <td className="py-1 text-right tabular-nums">{fmt(mo.supplied)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stock accuracy and sales against target, as rings                  */
/* ------------------------------------------------------------------ */

function Arc({ r, pct, colour, width }: { r: number; pct: number; colour: string; width: number }) {
  const c = 2 * Math.PI * r
  // Three quarters of a circle, opening at the bottom right, as in the design.
  const sweep = 0.75
  return (
    <>
      <circle r={r} fill="none" stroke={TRACK} strokeWidth={width} strokeLinecap="round" strokeDasharray={`${c * sweep} ${c}`} />
      <circle
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${c * sweep * Math.max(0, Math.min(1, pct / 100))} ${c}`}
      />
    </>
  )
}

export function StockRings({
  accuracy,
  salesVsTarget,
  categories,
}: {
  accuracy: { pct: number | null; checked: number; gaps: number }
  salesVsTarget: { pct: number | null; sold: number; target: number }
  categories: CategoryShare[]
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="-60 -60 120 120" className="h-40 w-40 shrink-0 rotate-90" role="img" aria-label={`Stock accuracy ${accuracy.pct ?? 'not known'}%, sales ${salesVsTarget.pct ?? 'no'}% of target`}>
          <Arc r={50} pct={accuracy.pct ?? 0} colour={SOLD} width={9} />
          <Arc r={36} pct={salesVsTarget.pct ?? 0} colour={SUPPLIED} width={9} />
        </svg>
        <div className="space-y-3">
          <div>
            <p className="text-4xl font-bold tabular-nums tracking-tight">{accuracy.pct === null ? '—' : `${accuracy.pct}%`}</p>
            <p className="text-xs text-muted-foreground">Stock accuracy this month</p>
          </div>
          <div className="space-y-1 text-xs">
            <p className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOLD }} />
              {accuracy.checked ? `${accuracy.checked - accuracy.gaps} of ${accuracy.checked} counts matched` : 'No counts checked yet'}
            </p>
            <p className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SUPPLIED }} />
              {salesVsTarget.target
                ? `${salesVsTarget.pct}% of store targets (${salesVsTarget.sold.toLocaleString('en-GB')} / ${salesVsTarget.target.toLocaleString('en-GB')})`
                : 'No store targets this month'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold text-muted-foreground">Sold this month by category</p>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales yet this month.</p>
        ) : (
          categories.map((c) => (
            <div key={c.name} className="flex items-center gap-3 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef6f1] text-[#1f5f47]">
                <PackageCheck className="h-4 w-4" />
              </span>
              <span className="flex-1 truncate font-medium">{c.name}</span>
              <span className="tabular-nums">{c.units.toLocaleString('en-GB')}</span>
              <span className="w-14 rounded-full bg-[#dcf5cf] py-0.5 text-center text-[11px] font-bold text-[#21570f]">{c.share}%</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Recent activity                                                     */
/* ------------------------------------------------------------------ */

const TONE: Record<Activity['status']['tone'], string> = {
  good: 'bg-[#e3f3ea] text-[#1f5f47]',
  warn: 'bg-[#fdf1d6] text-[#7a5200]',
  bad: 'bg-[#fde3dc] text-[#a3301a]',
  neutral: 'bg-muted text-muted-foreground',
}

const KIND_ICON = { count: ClipboardCheck, sales: ShoppingBag, supply: Truck }

export function RecentActivity({ items }: { items: Activity[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">What</th>
            <th className="pb-2 font-medium">Store</th>
            <th className="pb-2 font-medium">By</th>
            <th className="pb-2 font-medium">When</th>
            <th className="pb-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const Icon = KIND_ICON[a.kind]
            return (
              <tr key={`${a.kind}-${a.id}`} className="border-b border-border last:border-0">
                <td className="py-3">
                  <Link href={a.href} className="flex items-center gap-3 hover:underline">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eef6f1] text-[#1f5f47]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="font-medium">{a.what}</span>
                  </Link>
                </td>
                <td className="py-3">{a.store}</td>
                <td className="py-3 text-muted-foreground">{a.who}</td>
                <td className="whitespace-nowrap py-3 text-muted-foreground">
                  {new Date(a.at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-3 text-right">
                  <span className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold', TONE[a.status.tone])}>{a.status.label}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Top stores                                                          */
/* ------------------------------------------------------------------ */

export function TopStores({ stores }: { stores: StoreBar[] }) {
  if (!stores.length) return <p className="text-sm text-muted-foreground">No stores in X Metrics yet.</p>
  const top = Math.max(1, ...stores.map((s) => s.target ?? s.sold))
  return (
    <ul className="space-y-4">
      {stores.map((s, i) => {
        const of = s.target ?? top
        const pct = Math.min(100, Math.round((100 * s.sold) / Math.max(1, of)))
        return (
          <li key={s.id}>
            <Link href={`/admin/metrics/stores/${s.id}`} className="block space-y-1.5 hover:opacity-90">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef6f1] text-[11px] font-bold text-[#1f5f47]">{i + 1}</span>
                  <span className="truncate font-medium">{s.name}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <b className="text-foreground">{s.sold.toLocaleString('en-GB')}</b>
                  {s.target ? ` / ${s.target.toLocaleString('en-GB')}` : ' sold'}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: TRACK }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: i === 0 ? SOLD : SUPPLIED }} />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
