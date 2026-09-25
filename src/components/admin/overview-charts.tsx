'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/*
 * Chart colours, from the brand's own orange family, checked with the
 * data-viz palette validator (lightness band, chroma, colour-blind and
 * normal-vision separation, contrast on white):
 *   on time #d1511a · late #8a3a12  — all checks pass
 *   today's split adds #c98500      — passes, contrast 2.99:1, so every
 *                                     part is also labelled with its count
 * Values and labels stay in text colours; colour only marks the series.
 */
const ON_TIME = '#d1511a'
const LATE = '#8a3a12'
const SPLIT = ['#d1511a', '#8a3a12', '#c98500']

export interface DayCount {
  date: string
  /** e.g. "Mon" */
  label: string
  onTime: number
  late: number
}

function niceMax(value: number) {
  if (value <= 4) return 4
  const step = Math.pow(10, Math.floor(Math.log10(value)))
  // Steps that halve to a whole number, so the middle gridline reads cleanly.
  for (const m of [1, 2, 3, 4, 6, 8, 10]) {
    if (m * step >= value) return m * step
  }
  return 10 * step
}

/** Clock-ins per day for the last week, on time beside late. */
export function WeekChart({ days }: { days: DayCount[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(1, ...days.map((d) => Math.max(d.onTime, d.late))))
  const ticks = [max, max / 2, 0]

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: ON_TIME }} /> On time
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: LATE }} /> Late
        </span>
      </div>

      <div className="relative flex h-56 gap-3">
        {/* Y axis: three recessive ticks. */}
        <div className="flex w-6 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-dashed border-border" />
            ))}
          </div>

          <div className="absolute inset-x-0 bottom-0 top-0 flex items-stretch justify-between gap-2">
            {days.map((d, i) => (
              <div
                key={d.date}
                className="relative flex flex-1 flex-col items-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.label}: ${d.onTime} on time, ${d.late} late`}
              >
                <div
                  className={cn(
                    'flex w-full flex-1 items-end justify-center gap-0.5 rounded-xl pb-0 transition-colors',
                    hover === i && 'bg-muted/70',
                  )}
                >
                  {[
                    { v: d.onTime, c: ON_TIME },
                    { v: d.late, c: LATE },
                  ].map((bar, j) => (
                    <span
                      key={j}
                      className="block w-3 rounded-t sm:w-4"
                      style={{
                        background: bar.c,
                        height: `${(bar.v / max) * 100}%`,
                        minHeight: bar.v > 0 ? 3 : 0,
                      }}
                    />
                  ))}
                </div>
                <span className="mt-2 h-4 text-[11px] text-muted-foreground">{d.label}</span>

                {hover === i && (
                  <div className="pointer-events-none absolute left-1/2 top-2 z-10 w-max -translate-x-1/2 rounded-xl bg-card px-3 py-2 text-xs shadow-soft ring-1 ring-border">
                    <p className="font-bold">{d.label}</p>
                    <p className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: ON_TIME }} />
                      {d.onTime} on time
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: LATE }} />
                      {d.late} late
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export interface SplitPart {
  label: string
  value: number
}

/** Today's staff in three parts, as a ring with the parts labelled beside it. */
export function TodaySplit({ parts, centreLabel }: { parts: SplitPart[]; centreLabel: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = 42
  const circumference = 2 * Math.PI * r
  // A 2px surface gap between parts, in the ring's own units (100 wide).
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 1.4 : 0

  let offset = 0
  const arcs = parts.map((p, i) => {
    const length = total ? (p.value / total) * circumference : 0
    const arc = { i, length: Math.max(0, length - gap), offset }
    offset += length
    return arc
  })

  const shown = hover !== null ? parts[hover] : null

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
          {total > 0 &&
            arcs.map((a) =>
              a.length > 0 ? (
                <circle
                  key={a.i}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={SPLIT[a.i]}
                  strokeWidth={hover === a.i ? 14 : 12}
                  strokeDasharray={`${a.length} ${circumference - a.length}`}
                  strokeDashoffset={-a.offset}
                  onMouseEnter={() => setHover(a.i)}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-default transition-[stroke-width]"
                />
              ) : null,
            )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-extrabold tabular-nums">{shown ? shown.value : total}</span>
          <span className="max-w-[7rem] text-xs text-muted-foreground">{shown ? shown.label : centreLabel}</span>
        </div>
      </div>

      <ul className="w-full space-y-2 text-sm">
        {parts.map((p, i) => (
          <li
            key={p.label}
            className={cn('flex items-center gap-2 rounded-xl px-2 py-1', hover === i && 'bg-muted/70')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SPLIT[i] }} />
            <span className="flex-1">{p.label}</span>
            <span className="font-bold tabular-nums">{p.value}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {total ? Math.round((p.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
