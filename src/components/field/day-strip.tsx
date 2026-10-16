'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { addDays, cn, dayOfMonth, weekdayShort } from '@/lib/utils'
import { calendarMark, type CalendarDay } from '@/lib/schedule'
import { MARK_CLASS, MARK_WORD, WORD_CLASS } from '@/components/field/calendar-marks'

/**
 * The horizontal date picker from the reference. Seven days back from today,
 * newest last, the selected one filled with brand. Seven pills do not fit a
 * 360px screen, so the strip scrolls and brings the selected day into view.
 * A missed working day is red, a day off grey and leave soft orange, each
 * with its word.
 */
export function DayStrip({
  today,
  selected,
  basePath,
  marks,
  calendar = [],
}: {
  today: string
  selected: string
  basePath: string
  /** Dates with at least one event, so the strip shows where the data is. */
  marks: Set<string>
  /** The person's own days (my_calendar, migration 059). */
  calendar?: CalendarDay[]
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const byDay = new Map(calendar.map((d) => [d.day, d]))

  useEffect(() => {
    const active = scroller.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selected])

  return (
    <div ref={scroller} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-0.5">
      {days.map((date) => {
        const active = date === selected
        const mark = calendarMark(byDay.get(date))
        const word = MARK_WORD[mark]
        return (
          <Link
            key={date}
            href={`${basePath}?d=${date}`}
            scroll={false}
            data-active={active}
            aria-current={active ? 'date' : undefined}
            aria-label={`${date}${word ? `, ${word === 'Off' ? 'day off' : word.toLowerCase()}` : ''}`}
            className={cn(
              'flex h-[68px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl transition-all',
              active ? 'bg-brand text-primary-foreground shadow-lift' : mark === 'plain' || mark === 'worked' ? 'border border-border bg-card text-foreground' : MARK_CLASS[mark],
            )}
          >
            <span className="text-lg font-extrabold leading-none">{dayOfMonth(date)}</span>
            <span className={cn('text-[10px] font-semibold', active ? 'text-white/80' : 'opacity-70')}>
              {weekdayShort(date)}
            </span>
            {word ? (
              <span className={cn('text-[9px] leading-none', active ? 'font-bold text-white' : WORD_CLASS[mark])}>{word}</span>
            ) : (
              <span
                className={cn(
                  'mt-0.5 h-1 w-1 rounded-full',
                  marks.has(date) ? (active ? 'bg-white' : 'bg-brand') : 'bg-transparent',
                )}
              />
            )}
          </Link>
        )
      })}
    </div>
  )
}
