'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LATE, NOT_IN, ON_TIME } from '@/lib/chart-colours'

export { LATE, NOT_IN, ON_TIME }

/* Days not picked in the week chart fall back to greys, so the colour marks the one day being read. */
const IDLE = ['#e6e2de', '#efece9']

export interface DayCount {
  date: string
  /** e.g. "Mon" */
  label: string
  /** e.g. "Wednesday, 7 Oct" */
  long: string
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

/**
 * Clock-ins per day for the last week, on time under late. One day is in
 * colour with its figures beside it: today, or whichever day is pointed at.
 */
export function AttendanceChart({ days }: { days: DayCount[] }) {
  const [picked, setPicked] = useState(days.length - 1)
  const max = niceMax(Math.max(1, ...days.map((d) => d.onTime + d.late)))
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0]

  return (
    <div className="relative flex h-64 gap-3">
      <div className="flex w-7 flex-col justify-between pb-7 text-right text-[11px] tabular-nums text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
            {Number.isInteger(t) ? t : t.toFixed(1)}
          </span>
        ))}
      </div>

      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 bottom-7 top-0 flex flex-col justify-between">
          {ticks.map((t) => (
            <div key={t} className="border-t border-border" />
          ))}
        </div>

        <div className="absolute inset-0 flex items-stretch justify-between gap-2 sm:gap-3">
          {days.map((d, i) => {
            const on = picked === i
            const total = d.onTime + d.late
            return (
              <button
                type="button"
                key={d.date}
                className="group relative flex flex-1 flex-col items-center focus-visible:outline-none"
                onMouseEnter={() => setPicked(i)}
                onFocus={() => setPicked(i)}
                onClick={() => setPicked(i)}
                aria-pressed={on}
                aria-label={`${d.long}: ${d.onTime} on time, ${d.late} late`}
              >
                <div className="flex w-full max-w-[4.5rem] flex-1 flex-col justify-end gap-[3px] pb-0">
                  {d.late > 0 && (
                    <span
                      className={cn('block w-full rounded-lg transition-colors', on && 'hatch')}
                      style={{
                        height: `${(d.late / max) * 100}%`,
                        minHeight: 4,
                        background: on ? LATE : IDLE[1],
                      }}
                    />
                  )}
                  <span
                    className={cn('block w-full rounded-lg transition-colors', on && 'hatch')}
                    style={{
                      height: `${(d.onTime / max) * 100}%`,
                      minHeight: total === 0 ? 4 : d.onTime > 0 ? 4 : 0,
                      background: on ? ON_TIME : IDLE[0],
                    }}
                  />
                </div>
                <span
                  className={cn(
                    'mt-2 h-5 text-xs',
                    on ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {d.label}
                </span>

                {on && (
                  <div
                    className={cn(
                      'pointer-events-none absolute top-1 z-10 w-max rounded-xl border border-border bg-card px-3 py-2 text-left text-xs shadow-soft',
                      i >= days.length - 2 ? 'right-1/2' : 'left-1/2',
                    )}
                  >
                    <p className="mb-1 text-[11px] text-muted-foreground">{d.long}</p>
                    <Row colour={ON_TIME} label="On time" value={d.onTime} />
                    <Row colour={LATE} label="Late" value={d.late} />
                    <p className="mt-1 flex justify-between gap-6 border-t border-border pt-1 font-semibold">
                      <span>Clock-ins</span>
                      <span className="tabular-nums">{total}</span>
                    </p>
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

function Row({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <p className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} />
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </p>
  )
}

export interface Part {
  label: string
  value: number
  colour: string
}

/**
 * One bar cut into parts with a gap between them, then the parts listed
 * with their share. `of` is the whole the bar stands for; any part of it
 * not covered by `parts` shows as grey track.
 */
export function SegmentBar({ parts, of }: { parts: Part[]; of: number }) {
  const whole = Math.max(of, parts.reduce((s, p) => s + p.value, 0), 1)
  return (
    <div>
      <div className="flex h-7 w-full gap-1 overflow-hidden rounded-lg bg-muted">
        {parts.map((p) =>
          p.value > 0 ? (
            <span
              key={p.label}
              className="hatch block h-full rounded-md first:rounded-l-lg"
              style={{ width: `${(p.value / whole) * 100}%`, background: p.colour, minWidth: 6 }}
              title={`${p.label}: ${p.value}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-5 space-y-2.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2.5">
            <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: p.colour }} />
            <span className="flex-1">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.value}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">
              {Math.round((p.value / whole) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A half-ring in five blocks, filled to `pct`, with the figure inside. */
export function Gauge({ pct, label }: { pct: number; label: string }) {
  const value = Math.max(0, Math.min(100, pct))
  const cx = 100
  const cy = 100
  const r = 78
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(cx - r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`
  }
  const arc = (from: number, to: number) => `M ${point(from)} A ${r} ${r} 0 0 1 ${point(to)}`
  const filled = (value / 100) * 180
  const blocks = Array.from({ length: 5 }, (_, i) => [i * 36 + 2, (i + 1) * 36 - 2] as const)

  return (
    <div className="relative mx-auto w-full max-w-[17rem]">
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={`${value}% ${label}`}>
        <defs>
          <linearGradient id="gauge-fill" gradientUnits="userSpaceOnUse" x1="22" y1="0" x2="178" y2="0">
            <stop offset="0%" stopColor={LATE} />
            <stop offset="100%" stopColor={ON_TIME} />
          </linearGradient>
          <pattern id="gauge-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="7" fill="rgb(255 255 255 / 0.3)" />
          </pattern>
        </defs>
        {blocks.map(([a, b]) => (
          <path key={a} d={arc(a, b)} fill="none" stroke="hsl(var(--muted))" strokeWidth="26" />
        ))}
        {blocks.map(([a, b]) =>
          filled > a ? (
            <g key={`f${a}`}>
              <path d={arc(a, Math.min(b, filled))} fill="none" stroke="url(#gauge-fill)" strokeWidth="26" />
              <path d={arc(a, Math.min(b, filled))} fill="none" stroke="url(#gauge-hatch)" strokeWidth="26" />
            </g>
          ) : null,
        )}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-3xl font-bold tabular-nums tracking-tight">{value}%</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

/**
 * A ring cut into parts, with a 2px gap between them and the headline
 * figure in the middle, then the parts listed with their count and share
 * so no part is read by colour alone. Pointing at a part names it.
 */
export function Donut({ parts, centre, centreLabel }: { parts: Part[]; centre: string; centreLabel: string }) {
  const [picked, setPicked] = useState<number | null>(null)
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = 70
  const width = 26
  const around = 2 * Math.PI * r
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 2 : 0
  let start = 0

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative w-full max-w-[12rem] shrink-0">
        <svg viewBox="0 0 180 180" className="w-full -rotate-90" role="img" aria-label={`${centre} ${centreLabel}`}>
          <circle cx="90" cy="90" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={width} />
          {total > 0 &&
            parts.map((p, i) => {
              if (p.value <= 0) return null
              const length = (p.value / total) * around
              const dash = Math.max(length - gap, 1)
              const offset = -start
              start += length
              return (
                <circle
                  key={p.label}
                  cx="90"
                  cy="90"
                  r={r}
                  fill="none"
                  stroke={p.colour}
                  strokeWidth={picked === i ? width + 4 : width}
                  strokeDasharray={`${dash} ${around - dash}`}
                  strokeDashoffset={offset}
                  className="cursor-pointer transition-[stroke-width]"
                  onMouseEnter={() => setPicked(i)}
                  onMouseLeave={() => setPicked(null)}
                  onClick={() => setPicked(picked === i ? null : i)}
                >
                  <title>{`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}</title>
                </circle>
              )
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {picked !== null && total > 0 ? (
            <>
              <span className="text-2xl font-bold tabular-nums">{parts[picked].value}</span>
              <span className="px-6 text-xs text-muted-foreground">{parts[picked].label}</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold tabular-nums">{centre}</span>
              <span className="px-6 text-xs text-muted-foreground">{centreLabel}</span>
            </>
          )}
        </div>
      </div>
      <ul className="w-full space-y-2.5 text-sm">
        {parts.map((p, i) => (
          <li
            key={p.label}
            className={cn('flex items-center gap-2.5 rounded-md px-1', picked === i && 'bg-muted')}
            onMouseEnter={() => setPicked(i)}
            onMouseLeave={() => setPicked(null)}
          >
            <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: p.colour }} />
            <span className="flex-1">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.value}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">
              {total ? Math.round((p.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
