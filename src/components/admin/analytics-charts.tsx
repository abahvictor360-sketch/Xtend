'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ORANGE } from '@/lib/chart-colours'
import { niceMax } from '@/components/admin/overview-charts'

export interface StackPart {
  label: string
  value: number
  colour: string
}

export interface StackColumn {
  key: string
  /** Under the column, e.g. "Mon" or "14". */
  label: string
  /** In the pop-up, e.g. "Monday, 5 Oct". */
  long: string
  parts: StackPart[]
  /** Extra lines in the pop-up, e.g. "On time: 92%". */
  notes?: string[]
}

/**
 * Columns cut into parts, drawn the same way as the overview's week chart:
 * the column pointed at is in colour with its figures beside it, the rest
 * stay pale so one column is read at a time. With many columns, only some
 * are labelled underneath.
 */
export function StackChart({
  columns,
  max: fixedMax,
  unit = '',
  height = 'h-60',
  total = 'Total',
}: {
  columns: StackColumn[]
  /** A fixed top, e.g. 100 for percentages; otherwise from the data. */
  max?: number
  unit?: string
  height?: string
  /** What the sum is called in the pop-up, or null for none. */
  total?: string | null
}) {
  const [picked, setPicked] = useState<number | null>(null)
  if (!columns.length) return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
  const sums = columns.map((c) => c.parts.reduce((s, p) => s + p.value, 0))
  const max = fixedMax ?? niceMax(Math.max(1, ...sums))
  const ticks = [max, max / 2, 0]
  const every = columns.length > 20 ? Math.ceil(columns.length / 10) : 1

  return (
    <div className={cn('relative flex gap-2', height)} onMouseLeave={() => setPicked(null)}>
      <div className="flex w-8 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
            {Number.isInteger(t) ? t : t.toFixed(1)}
            {unit}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
          {ticks.map((t) => (
            <div key={t} className="border-t border-border" />
          ))}
        </div>
        <div className={cn('absolute inset-0 flex items-stretch justify-between', columns.length > 20 ? 'gap-px' : 'gap-1 sm:gap-2')}>
          {columns.map((c, i) => {
            const on = picked === i
            return (
              <button
                type="button"
                key={c.key}
                className="group relative flex min-w-0 flex-1 flex-col items-center focus-visible:outline-none"
                onMouseEnter={() => setPicked(i)}
                onFocus={() => setPicked(i)}
                onClick={() => setPicked(i)}
                aria-pressed={on}
                aria-label={`${c.long}: ${c.parts.map((p) => `${p.value}${unit} ${p.label}`).join(', ')}`}
              >
                <div className="flex w-full max-w-[3.5rem] flex-1 flex-col-reverse gap-[2px]">
                  {c.parts.map((p) =>
                    p.value > 0 ? (
                      <span
                        key={p.label}
                        className={cn('block w-full rounded-[4px] transition-opacity', picked !== null && !on && 'opacity-40')}
                        style={{ height: `${(p.value / max) * 100}%`, minHeight: 3, background: p.colour }}
                      />
                    ) : null,
                  )}
                  {sums[i] === 0 && <span className="block h-[3px] w-full rounded-[4px]" style={{ background: ORANGE.track }} />}
                </div>
                <span
                  className={cn(
                    'mt-1.5 h-4 whitespace-nowrap text-[11px] leading-4',
                    on ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    i % every !== 0 && !on && 'invisible',
                  )}
                >
                  {c.label}
                </span>
                {on && (
                  <div
                    className={cn(
                      'pointer-events-none absolute top-1 z-10 w-max max-w-[14rem] rounded-xl border border-border bg-card px-3 py-2 text-left text-xs shadow-soft',
                      i >= columns.length / 2 ? 'right-1/2' : 'left-1/2',
                    )}
                  >
                    <p className="mb-1 text-[11px] text-muted-foreground">{c.long}</p>
                    {c.parts.map((p) => (
                      <p key={p.label} className="flex items-center justify-between gap-6">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.colour }} />
                          {p.label}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {Math.round(p.value)}
                          {unit}
                        </span>
                      </p>
                    ))}
                    {total && c.parts.length > 1 && (
                      <p className="mt-1 flex justify-between gap-6 border-t border-border pt-1 font-semibold">
                        <span>{total}</span>
                        <span className="tabular-nums">{sums[i]}</span>
                      </p>
                    )}
                    {c.notes?.map((n) => (
                      <p key={n} className="mt-0.5 text-muted-foreground">
                        {n}
                      </p>
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** The colour key under a chart. */
export function ChartKey({ parts }: { parts: { label: string; colour: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {parts.map((p) => (
        <span key={p.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.colour }} />
          {p.label}
        </span>
      ))}
    </div>
  )
}

export interface RankRow {
  key: string
  label: string
  value: number
  /** What is printed beside the bar, e.g. "4 days" or "62%". */
  text: string
  detail?: string
  href?: string
}

/**
 * A short ranked list, one bar each against the longest (or against 100
 * for percentages), the figure beside it in text ink.
 */
export function RankList({ rows, of, colour = ORANGE.main }: { rows: RankRow[]; of?: number; colour?: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nobody here. Good.</p>
  const max = of ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const body = (
          <>
            <span className="w-28 shrink-0 truncate text-sm font-medium group-hover:text-brand sm:w-36">{r.label}</span>
            <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded" style={{ background: ORANGE.track }}>
              {r.value > 0 && (
                <span
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${Math.min(100, (r.value / max) * 100)}%`, minWidth: 4, background: colour }}
                />
              )}
            </span>
            <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">{r.text}</span>
          </>
        )
        const title = `${r.label}: ${r.text}${r.detail ? ` · ${r.detail}` : ''}`
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} title={title} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60">
                {body}
              </Link>
            ) : (
              <div title={title} className="flex items-center gap-2 px-1 py-0.5">
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
