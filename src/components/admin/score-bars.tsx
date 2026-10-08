import Link from 'next/link'
import { ON_TIME as BAR } from '@/lib/chart-colours'

export interface ScoreRow {
  key: string
  label: string
  /** 0 to 100, or null when there is nothing to judge it on. */
  value: number | null
  detail?: string
  href?: string
}

/**
 * One horizontal bar per row on a shared 0-100 scale, the figure beside
 * it in text ink. A row with a link opens it (a person's X Metrics).
 */
export function ScoreBars({ rows, unit = '%' }: { rows: ScoreRow[]; unit?: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const value = row.value === null ? null : Math.max(0, Math.min(100, row.value))
        const body = (
          <>
            <span className="w-32 shrink-0 truncate text-sm font-medium group-hover:text-brand sm:w-44">{row.label}</span>
            <span className="relative h-5 flex-1 overflow-hidden rounded-md bg-muted">
              {value !== null && value > 0 && (
                <span
                  className="hatch absolute inset-y-0 left-0 rounded-md"
                  style={{ width: `${value}%`, background: BAR, minWidth: 4 }}
                />
              )}
            </span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
              {value === null ? '—' : `${Math.round(value)}${unit}`}
            </span>
          </>
        )
        const title = `${row.label}: ${value === null ? 'no data' : `${Math.round(value)}${unit}`}${row.detail ? ` · ${row.detail}` : ''}`
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} title={title} className="group flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-muted/60">
                {body}
              </Link>
            ) : (
              <div title={title} className="flex items-center gap-3 px-1 py-0.5">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
