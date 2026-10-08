import Link from 'next/link'
import { cn } from '@/lib/utils'
import { DAY_COLOUR, ORANGE } from '@/lib/chart-colours'
import { cellTitle, weekday, type DayRecord, type DayStatus, type Person } from '@/lib/attendance-report'

/** The letter in each cell, so a day is never read by colour alone. */
const MARK: Record<DayStatus, string> = { on_time: '', late: 'L', off_site: 'O', absent: 'A', rest: '', none: '' }

const STYLE: Record<DayStatus, React.CSSProperties> = {
  on_time: { background: DAY_COLOUR.on_time, color: '#fff' },
  late: { background: DAY_COLOUR.late, color: ORANGE.dark },
  off_site: { background: DAY_COLOUR.off_site, color: '#fff' },
  absent: { background: DAY_COLOUR.absent, color: '#fff' },
  rest: { background: DAY_COLOUR.rest },
  none: {},
}

/**
 * A row per person and a square per day, coloured by how the day went.
 * Tapping a square opens that person's day in the table below. A small
 * dot in the corner marks a day they never clocked out.
 */
export function AttendanceGrid({
  people,
  records,
  days,
  dayHref,
}: {
  people: Person[]
  records: DayRecord[]
  days: string[]
  dayHref: (userId: string, date: string) => string
}) {
  const byKey = new Map(records.map((r) => [r.key, r]))
  const rows = people
    .map((p) => {
      const cells = days.map((d) => byKey.get(`${p.id}|${d}`) ?? null)
      return {
        person: p,
        cells,
        came: cells.filter((c) => c?.present).length,
        expected: cells.filter((c) => c && (c.present || c.status === 'absent')).length,
      }
    })
    .filter((r) => r.cells.some((c) => c && c.status !== 'none'))

  if (!rows.length) return <p className="text-sm text-muted-foreground">Nobody to show for these days.</p>

  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="border-separate border-spacing-[3px] text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card pr-2 text-left font-semibold text-muted-foreground">Person</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={cn('w-6 min-w-6 text-center font-medium tabular-nums', weekday(d) === 0 ? 'text-brand' : 'text-muted-foreground')}
                  title={d}
                >
                  <span className="block text-[10px] leading-3">{'SMTWTFS'[weekday(d)]}</span>
                  {Number(d.slice(8, 10))}
                </th>
              ))}
              <th className="pl-2 text-right font-semibold text-muted-foreground">Came</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ person, cells, came, expected }) => (
              <tr key={person.id}>
                <th scope="row" className="sticky left-0 z-10 max-w-[8.5rem] truncate bg-card pr-2 text-left font-semibold sm:max-w-[12rem]">
                  {person.name}
                </th>
                {cells.map((c, i) =>
                  c && c.status !== 'none' ? (
                    <td key={days[i]} className="p-0">
                      <Link
                        href={dayHref(person.id, days[i])}
                        title={cellTitle(c, person.name)}
                        aria-label={cellTitle(c, person.name)}
                        className="relative flex h-6 w-6 items-center justify-center rounded-[5px] text-[10px] font-bold hover:ring-2 hover:ring-brand/60"
                        style={STYLE[c.status]}
                      >
                        {MARK[c.status]}
                        {c.missingOut && (
                          <span
                            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white"
                            style={{ background: c.status === 'late' ? ORANGE.dark : ORANGE.light }}
                          />
                        )}
                        {c.onShift && <span className="absolute bottom-0.5 h-0.5 w-3 rounded-full bg-white/80" />}
                      </Link>
                    </td>
                  ) : (
                    <td key={days[i]} className="p-0">
                      <span className="block h-6 w-6 rounded-[5px] border border-dashed border-border" />
                    </td>
                  ),
                )}
                <td className="whitespace-nowrap pl-2 text-right tabular-nums text-muted-foreground">
                  {came}/{expected}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GridKey />
    </div>
  )
}

export function GridKey() {
  const items: [DayStatus, string][] = [
    ['on_time', 'On time'],
    ['late', 'L  Late'],
    ['off_site', 'O  Off site or flagged'],
    ['absent', 'A  Absent'],
    ['rest', 'Sunday, not expected'],
  ]
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(([s, label]) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: STYLE[s].background }} />
          {label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: ORANGE.light }} /> No clock-out
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border border-dashed border-border" /> Not on the team yet
      </span>
    </div>
  )
}
