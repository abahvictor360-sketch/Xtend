'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { CalendarDays, CheckCircle2, ChevronRight, Clock3, FileText, LogIn, LogOut, MapPin, Palmtree, Store } from 'lucide-react'
import { GreetingHeader } from '@/components/field/greeting-header'
import { LocationGate } from '@/components/field/location-gate'
import { useLocationGate } from '@/components/field/use-location-gate'
import { useHeartbeat } from '@/components/field/heartbeat'
import { useDashboardRefresh } from '@/components/field/use-dashboard-refresh'
import { ShiftTracker } from '@/components/field/shift-tracker'
import { usePlace } from '@/components/field/use-place'
import { OutboxBanner } from '@/components/field/outbox-banner'
import { ClockPanel } from '@/components/field/clock-panel'
import type { VisitOutlet, VisitRow } from '@/components/field/store-visits'
import { SectionHeader } from '@/components/field/screen'
import { Chip } from '@/components/ui/chip'
import { Card, CardContent } from '@/components/ui/card'
import { haversineMetres } from '@/lib/geo'
import { addDays, cn, dayOfMonth, formatLagos, metres, weekdayShort } from '@/lib/utils'
import type { DayState } from '@/lib/types'
import { calendarMark, type CalendarDay } from '@/lib/schedule'
import { CalendarLegend, MARK_CLASS, MARK_WORD, WORD_CLASS } from '@/components/field/calendar-marks'

type Tab = 'stores' | 'day' | 'outlet'

const StoreVisits = dynamic(
  () => import('@/components/field/store-visits').then((module) => module.StoreVisits),
  {
    loading: () => <div className="h-48 animate-pulse rounded-2xl bg-muted" aria-label="Loading stores" />,
  },
)

export function FieldHome({
  day,
  visits,
  outlets,
  canVisitStores,
  notificationsRequired = true,
  avatarUrl = null,
  userId,
  calendar = [],
}: {
  day: DayState
  visits: VisitRow[]
  outlets: VisitOutlet[]
  canVisitStores: boolean
  notificationsRequired?: boolean
  avatarUrl?: string | null
  userId: string
  /** The last seven days from my_calendar (migration 059). */
  calendar?: CalendarDay[]
}) {
  const router = useRouter()
  const gate = useLocationGate()
  // Marketers work store to store, so that is their first screen.
  const visitsStore = canVisitStores
  const [tab, setTab] = useState<Tab>(visitsStore ? 'stores' : 'day')

  const tabs: { id: Tab; label: string }[] = [
    ...(visitsStore ? [{ id: 'stores' as Tab, label: 'Stores' }] : []),
    { id: 'day', label: 'My day' },
    { id: 'outlet', label: visitsStore ? 'Base' : 'Outlet' },
  ]

  const onShift = Boolean(day.opening) && !day.closing
  const todayKind = calendar.find((c) => c.day === day.date)?.kind ?? 'working'
  // Runs quietly while on shift; nothing about it is shown here.
  useHeartbeat(onShift && gate.status === 'ready')
  useDashboardRefresh(onShift, userId)

  const { place, loading: placeLoading } = usePlace(gate.fix)
  const whereIAm = place?.label ?? place?.address ?? null

  // A store waiting for its location has nothing to measure against.
  const outletPinned = day.outlet?.lat != null && day.outlet.lng != null
  const liveDistance =
    gate.fix && day.outlet?.lat != null && day.outlet.lng != null
      ? haversineMetres(gate.fix.lat, gate.fix.lng, day.outlet.lat, day.outlet.lng)
      : null
  const inside = liveDistance !== null && day.outlet ? liveDistance <= day.outlet.radius_m : null

  const steps = [
    { done: Boolean(day.opening), label: 'Clock in' },
    { done: onShift || Boolean(day.closing), label: 'On shift' },
    ...(day.can_file_report ? [{ done: day.report_filed, label: 'Daily report' }] : []),
    { done: Boolean(day.closing), label: 'Clock out' },
  ]
  const progress = Math.round((steps.filter((s) => s.done).length / steps.length) * 100)

  return (
    <div className="space-y-5">
      <GreetingHeader
        fullName={day.profile?.full_name ?? 'there'}
        avatarUrl={avatarUrl}
        subtitle={
          onShift ? 'Have a good shift!' : day.closing ? 'Nice work today!' : 'Have a nice day!'
        }
      />

      <OutboxBanner onFlushed={() => router.refresh()} />

      <ShiftTracker onShift={onShift} clockedOut={Boolean(day.closing)} />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {tabs.map((item) => (
          <Chip key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </Chip>
        ))}
      </div>

      <ShiftPill
        state={day.closing ? 'done' : onShift ? 'on' : 'before'}
        since={day.opening ? formatLagos(day.opening.at, false) : null}
        outletName={day.outlet?.name ?? null}
      />

      {todayKind !== 'working' && !day.opening && <NotWorkingToday kind={todayKind} />}

      <WeekRow today={day.date} calendar={calendar} />

      <DayCard day={day} steps={steps} progress={progress} onShift={onShift} />

      {gate.status === 'ready' && (
        <div className="flex items-start gap-2 rounded-2xl bg-tint px-3 py-2.5 text-tint-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs leading-snug">
            <span className="font-semibold">You are at </span>
            {whereIAm ?? (placeLoading ? 'finding the place name…' : 'an unnamed spot')}
            {place?.source === 'outlet' && (
              <span className="ml-1 font-semibold">(your assigned store)</span>
            )}
            {gate.fix && (
              <span className="block text-[11px] opacity-80">
                {gate.fix.lat.toFixed(5)}, {gate.fix.lng.toFixed(5)} · accurate to ±
                {Math.round(gate.fix.accuracy_m)} m
                {liveDistance !== null && ` · ${metres(liveDistance)} from your outlet`}
              </span>
            )}
          </p>
        </div>
      )}

      <div id="clock" className="scroll-mt-4">
      <LocationGate
        status={gate.status}
        reason={gate.reason}
        message={gate.message}
        onRetry={() => void gate.retry()}
      >
        <ClockPanel day={day} notificationsRequired={notificationsRequired} />
      </LocationGate>
      </div>

      {tab === 'stores' && visitsStore && (
        <StoreVisits
          outlets={outlets}
          visits={visits}
          currentFix={gate.fix ? { lat: gate.fix.lat, lng: gate.fix.lng } : null}
        />
      )}

      {tab === 'day' && (
        <section className="space-y-3">
          <SectionHeader
            title="Progress"
            action={<span className="text-xs font-semibold text-brand">{progress}% done</span>}
          />

          <RingRow
            icon={<LogIn className="h-5 w-5" />}
            title={day.opening ? formatLagos(day.opening.at, false) : 'Clock in'}
            meta={
              day.opening
                ? `Clocked in · ${day.opening.status === 'on_site' ? 'on site' : day.opening.status === 'off_site' ? 'off site' : 'not confirmed'}`
                : 'Not yet today'
            }
            done={Boolean(day.opening)}
            warn={day.opening?.status === 'off_site'}
          />

          {day.can_file_report && (
            <Link href="/field/report" className="block">
              <RingRow
                icon={<FileText className="h-5 w-5" />}
                title="Daily report"
                meta={day.report_filed ? 'Filed. Editable until midnight.' : 'Not filed yet · tap to file'}
                done={day.report_filed}
              />
            </Link>
          )}

          <RingRow
            icon={<LogOut className="h-5 w-5" />}
            title={day.closing ? formatLagos(day.closing.at, false) : 'Clock out'}
            meta={
              day.closing
                ? 'Clocked out'
                : day.opening
                  ? 'At the end of your shift'
                  : 'Clock in first'
            }
            done={Boolean(day.closing)}
          />
        </section>
      )}

      {tab === 'outlet' && (
        <section className="space-y-3">
          <SectionHeader title="Your outlet" />
          {day.outlet ? (
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div className="flex items-start gap-3">
                  <span className="icon-tile">
                    <Store className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{day.outlet.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {day.outlet.address ?? 'No address on file'}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Detail label="Shift" value={`${day.outlet.shift_start.slice(0, 5)} – ${day.outlet.shift_end.slice(0, 5)}`} />
                  <Detail label="Geofence" value={`${day.outlet.radius_m} m`} />
                  <Detail
                    label="You are"
                    value={
                      !outletPinned
                        ? 'Not on the map yet'
                        : liveDistance === null
                          ? 'Locating…'
                          : `${metres(liveDistance)} away`
                    }
                    tone={inside === null ? undefined : inside ? 'good' : 'bad'}
                  />
                  <Detail label="Your location" value={whereIAm ?? 'Unnamed spot'} />
                  <Detail
                    label="Fix accuracy"
                    value={gate.fix ? `±${Math.round(gate.fix.accuracy_m)} m` : '—'}
                  />
                </dl>

                {gate.fix && outletPinned && (
                  <a
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand"
                    href={`https://www.openstreetmap.org/?mlat=${day.outlet.lat}&mlon=${day.outlet.lng}#map=17/${day.outlet.lat}/${day.outlet.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Open the outlet on a map
                  </a>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-3 pt-5 text-sm text-muted-foreground">
                <p>No outlet is assigned to you yet.</p>
                <p className="text-xs">
                  Ask your supervisor to assign one before you clock in.
                </p>
                <Link href="/field/support" className="inline-flex text-xs font-semibold text-brand hover:underline">
                  Contact support
                </Link>
              </CardContent>
            </Card>
          )}
        </section>
      )}

    </div>
  )
}

/** The dark bar at the top: where the shift stands, and the next step. */
function ShiftPill({
  state,
  since,
  outletName,
}: {
  state: 'before' | 'on' | 'done'
  since: string | null
  outletName: string | null
}) {
  const title = state === 'before' ? "Today's shift" : state === 'on' ? 'On shift' : 'Shift complete'
  const meta =
    state === 'before'
      ? (outletName ?? 'Clock in when you arrive')
      : state === 'on'
        ? `Since ${since}${outletName ? ` · ${outletName}` : ''}`
        : 'See you next time'
  return (
    <div className="flex items-center gap-3 rounded-full bg-[hsl(24_14%_11%)] p-2 pr-2.5 text-white">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand">
        {state === 'done' ? <CheckCircle2 className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        <span className="block truncate text-xs text-white/70">{meta}</span>
      </span>
      {state === 'before' ? (
        <a
          href="#clock"
          className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand transition-opacity hover:opacity-90"
        >
          Clock in
        </a>
      ) : (
        <span className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wide">
          {state === 'on' ? 'Live' : 'Done'}
        </span>
      )}
    </div>
  )
}

/** Today is a day off or leave. Clocking in still works if they are in. */
function NotWorkingToday({ kind }: { kind: 'off' | 'leave' }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground">
        <Palmtree className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold">{kind === 'leave' ? 'On leave today' : 'Day off today'}</p>
        <p className="text-xs text-muted-foreground">
          {kind === 'leave' ? 'Enjoy your leave.' : 'Enjoy your rest.'} If you are working today, clock in as usual.
        </p>
      </div>
    </div>
  )
}

/**
 * The last seven days as round dates; each opens that day in History. A
 * missed working day is red, a day off grey and leave soft orange, each
 * with its word under it.
 */
function WeekRow({ today, calendar }: { today: string; calendar: CalendarDay[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const byDay = new Map(calendar.map((c) => [c.day, c]))
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {days.map((date) => {
          const isToday = date === today
          const mark = calendarMark(byDay.get(date))
          const word = MARK_WORD[mark]
          return (
            <Link
              key={date}
              href={`/field/history?d=${date}`}
              aria-label={`${weekdayShort(date)} ${dayOfMonth(date)}${word ? `, ${word === 'Off' ? 'day off' : word.toLowerCase()}` : ''}`}
              className="flex flex-col items-center gap-1.5"
            >
              <span className={cn('text-xs', isToday ? 'font-bold text-foreground' : 'text-muted-foreground')}>
                {weekdayShort(date)}
              </span>
              <span
                className={cn(
                  'flex aspect-square w-full max-w-[2.75rem] items-center justify-center rounded-full text-sm tabular-nums transition-colors',
                  mark === 'plain' || mark === 'worked'
                    ? isToday
                      ? 'bg-card font-bold text-foreground shadow-[0_8px_20px_-12px_rgb(24_18_14/0.45)]'
                      : 'border border-border text-muted-foreground hover:bg-card'
                    : MARK_CLASS[mark],
                  isToday && 'font-bold',
                )}
              >
                {dayOfMonth(date)}
              </span>
              <span className={cn('h-3 text-[9px] leading-3', WORD_CLASS[mark])}>
                {word || (mark === 'worked' ? '•' : '')}
              </span>
            </Link>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CalendarLegend />
        <Link href="/field/leave" className="flex items-center gap-1 text-xs font-semibold text-brand">
          <CalendarDays className="h-3.5 w-3.5" />
          Ask for leave
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

/** Bar labels under the orange card's progress bars. */
const SHORT: Record<string, string> = {
  'Clock in': 'In',
  'On shift': 'Shift',
  'Daily report': 'Report',
  'Clock out': 'Out',
}

/** The big orange card: today's progress, one bar per step. */
function DayCard({
  day,
  steps,
  progress,
  onShift,
}: {
  day: DayState
  steps: { done: boolean; label: string }[]
  progress: number
  onShift: boolean
}) {
  const status = day.closing ? 'Done' : onShift ? 'In progress' : 'Not started'
  return (
    <section className="brand-surface relative overflow-hidden rounded-[2rem] p-5">
      {/* Soft shapes behind the content, as in the reference. */}
      <span aria-hidden className="absolute -right-10 top-6 h-56 w-28 rotate-[25deg] rounded-full bg-white/10" />
      <span aria-hidden className="absolute right-16 -top-16 h-56 w-24 rotate-[25deg] rounded-full bg-white/[0.07]" />

      <div className="relative flex items-start justify-between">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-brand">
          <Store className="h-6 w-6" />
        </span>
        <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand">{status}</span>
      </div>

      <div className="relative mt-8 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xl font-bold italic">My day</p>
          <p className="mt-1 text-lg italic text-white/90">{progress}% done</p>
          <p className="mt-1 truncate text-xs text-white/75">
            {day.outlet
              ? `${day.outlet.name} · ${day.outlet.shift_start.slice(0, 5)}–${day.outlet.shift_end.slice(0, 5)}`
              : 'Have a good day'}
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-2" aria-label={`${progress}% of today done`}>
          {steps.map((step) => (
            <div key={step.label} className="flex flex-col items-center gap-1.5" title={step.label}>
              <span
                className={cn(
                  'relative block w-6 rounded-full',
                  step.done ? 'h-20 bg-white' : 'h-9 bg-white/35',
                )}
              >
                <span
                  className={cn(
                    'absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ring-2',
                    step.done ? 'bg-white ring-brand' : 'bg-white/60 ring-transparent',
                  )}
                />
              </span>
              <span className="text-[10px] font-semibold text-white/85">{SHORT[step.label] ?? step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** A rounded row with a white icon disc and a ring that closes when done. */
function RingRow({
  icon,
  title,
  meta,
  done,
  warn,
}: {
  icon: React.ReactNode
  title: string
  meta: string
  done: boolean
  warn?: boolean
}) {
  const r = 20
  const c = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3 rounded-full bg-card p-2 pr-3">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tint text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-semibold leading-tight">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
        <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="24" cy="24" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
          {done && (
            <circle
              cx="24"
              cy="24"
              r={r}
              fill="none"
              stroke={warn ? 'hsl(var(--warning))' : 'hsl(var(--brand))'}
              strokeWidth="4"
              strokeDasharray={`${c} ${c}`}
            />
          )}
        </svg>
        <span className="text-[11px] font-bold italic">{done ? 'Done' : 'Due'}</span>
      </span>
    </div>
  )
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd
        className={`mt-0.5 font-semibold ${
          tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
