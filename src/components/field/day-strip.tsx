'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { addDays, cn, dayOfMonth, weekdayShort } from '@/lib/utils'

/**
 * The horizontal date picker from the reference. Seven days back from today,
 * newest last, the selected one filled with brand. Seven pills do not fit a
 * 360px screen, so the strip scrolls and brings the selected day into view.
 */
export function DayStrip({
  today,
  selected,
  basePath,
  marks,
}: {
  today: string
  selected: string
  basePath: string
  /** Dates with at least one event, so the strip shows where the data is. */
  marks: Set<string>
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))

  useEffect(() => {
    const active = scroller.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selected])

  return (
    <div ref={scroller} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {days.map((date) => {
        const active = date === selected
        return (
          <Link
            key={date}
            href={`${basePath}?d=${date}`}
            scroll={false}
            data-active={active}
            aria-current={active ? 'date' : undefined}
            className={cn(
              'flex h-[68px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl transition-all',
              active
                ? 'bg-brand text-primary-foreground shadow-lift'
                : 'bg-tint text-tint-foreground',
            )}
          >
            <span className="text-lg font-extrabold leading-none">{dayOfMonth(date)}</span>
            <span className={cn('text-[10px] font-semibold', active ? 'text-white/80' : 'opacity-70')}>
              {weekdayShort(date)}
            </span>
            <span
              className={cn(
                'mt-0.5 h-1 w-1 rounded-full',
                marks.has(date) ? (active ? 'bg-white' : 'bg-brand') : 'bg-transparent',
              )}
            />
          </Link>
        )
      })}
    </div>
  )
}
