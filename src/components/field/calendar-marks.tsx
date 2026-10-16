import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MARK_LABEL,
  WEEKDAYS,
  calendarMark,
  monthWeeks,
  shiftMonth,
  type CalendarDay,
  type CalendarMark,
} from '@/lib/schedule'

/**
 * How each kind of day looks on the staff calendars: a missed working day
 * in red, a day off in grey, leave in a soft orange, the rest as before.
 * Every kind also carries a word, so colour is never the only sign.
 */
export const MARK_CLASS: Record<CalendarMark, string> = {
  worked: 'border border-border bg-card text-foreground',
  missed: 'bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/50',
  off: 'bg-muted text-muted-foreground',
  leave: 'bg-[#fbe4d3] text-brand-deep ring-1 ring-inset ring-[#f2b48a]',
  plain: 'border border-border text-muted-foreground',
}

/** The small word under a day ("Missed", "Off", "Leave"). */
export const MARK_WORD: Record<CalendarMark, string> = {
  worked: '',
  missed: 'Missed',
  off: 'Off',
  leave: 'Leave',
  plain: '',
}

export const WORD_CLASS: Record<CalendarMark, string> = {
  worked: 'font-bold text-brand',
  missed: 'font-bold text-destructive',
  off: 'text-muted-foreground',
  leave: 'font-semibold text-brand-deep',
  plain: 'text-muted-foreground',
}

export function byDay(calendar: CalendarDay[]) {
  return new Map(calendar.map((d) => [d.day, d]))
}

/** What the colours mean, under each calendar. */
export function CalendarLegend({ className }: { className?: string }) {
  const items: CalendarMark[] = ['worked', 'missed', 'off', 'leave']
  return (
    <div className={cn('flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground', className)}>
      {items.map((m) => (
        <span key={m} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded-full', MARK_CLASS[m])} />
          {m === 'worked' ? 'Clocked in' : MARK_LABEL[m]}
        </span>
      ))}
    </div>
  )
}

/**
 * A month, Monday first, each day coloured by how it went. Tapping a day
 * opens it below; the arrows move a month (never past this one).
 */
export function MonthCalendar({
  month,
  today,
  selected,
  calendar,
  basePath,
}: {
  /** Any date in the month shown. */
  month: string
  today: string
  selected: string
  calendar: CalendarDay[]
  basePath: string
}) {
  const days = byDay(calendar)
  const weeks = monthWeeks(month)
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  const canNext = next.slice(0, 7) <= today.slice(0, 7)
  const monthName = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month.slice(0, 7)}-01T12:00:00Z`),
  )
  const counts = { missed: 0, off: 0, leave: 0 }
  for (const d of calendar) {
    if (d.day.slice(0, 7) !== month.slice(0, 7)) continue
    const m = calendarMark(d)
    if (m === 'missed' || m === 'off' || m === 'leave') counts[m] += 1
  }

  return (
    <div className="surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`${basePath}?d=${prev}`}
          scroll={false}
          aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <p className="text-sm font-bold">{monthName}</p>
        {canNext ? (
          <Link
            href={`${basePath}?d=${next}`}
            scroll={false}
            aria-label="Next month"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className="h-9 w-9" />
        )}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w.dow}>{w.short.slice(0, 2)}</span>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((week, i) => (
          <div key={i} className="grid grid-cols-7 gap-1">
            {week.map((date, j) => {
              if (!date) return <span key={j} />
              // Missed is only ever a past day (my_calendar); days off and
              // leave show ahead too, so people can see what is planned.
              const mark = calendarMark(days.get(date))
              const isToday = date === today
              const active = date === selected
              return (
                <Link
                  key={date}
                  href={`${basePath}?d=${date}`}
                  scroll={false}
                  aria-label={`${date}${MARK_LABEL[mark] ? `, ${MARK_LABEL[mark]}` : ''}`}
                  aria-current={active ? 'date' : undefined}
                  className={cn(
                    'flex h-11 flex-col items-center justify-center rounded-xl text-sm tabular-nums',
                    MARK_CLASS[mark],
                    active && 'outline outline-2 outline-offset-1 outline-brand',
                    isToday && 'font-extrabold',
                    date > today && 'opacity-60',
                  )}
                >
                  <span className="leading-none">{Number(date.slice(8, 10))}</span>
                  <span className={cn('mt-0.5 text-[8.5px] leading-none', WORD_CLASS[mark])}>
                    {MARK_WORD[mark] || (mark === 'worked' ? '•' : isToday ? 'Today' : '')}
                  </span>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
      <CalendarLegend />
      {(counts.missed > 0 || counts.off > 0 || counts.leave > 0) && (
        <p className="text-xs text-muted-foreground">
          {[
            counts.missed ? `${counts.missed} missed` : null,
            counts.off ? `${counts.off} day${counts.off === 1 ? '' : 's'} off` : null,
            counts.leave ? `${counts.leave} day${counts.leave === 1 ? '' : 's'} of leave` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
