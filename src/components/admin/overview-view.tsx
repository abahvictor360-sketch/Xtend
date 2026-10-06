import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  MoreHorizontal,
  Phone,
  Route,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { LiveAlertFeed } from '@/components/admin/live-alert-feed'
import { LiveLocations, type LiveLocation } from '@/components/admin/live-locations'
import {
  AttendanceChart,
  Gauge,
  LATE,
  NOT_IN,
  ON_TIME,
  SegmentBar,
  type DayCount,
} from '@/components/admin/overview-charts'
import { TZ, cn, formatLagos } from '@/lib/utils'
import type { AlertDetail } from '@/lib/types'


interface Overview {
  date: string
  staff_total: number
  clocked_in: number
  clocked_out: number
  still_on_shift: number
  absent: number
  late: number
  off_site: number
  open_alerts: number
}

interface CoverageRow {
  user_id: string
  full_name: string
  outlet_name: string | null
  ping_count: number
  coverage_pct: number | null
  last_ping_at: string | null
}

interface Absentee {
  user_id: string
  full_name: string
  phone: string | null
  outlet_name: string | null
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()),
  )
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

const day = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options })

export interface OverviewData {
  name: string
  isAdmin: boolean
  today: string
  week: DayCount[]
  stats: Partial<Overview>
  away: Absentee[]
  tracked: CoverageRow[]
  onShift: LiveLocation[]
  alerts: AlertDetail[]
  photos: {
    last_run_at: string | null
    last_result: { photos_deleted?: number; at?: string } | null
    photos_held: number
    overdue: number
  } | null
}

/** The overview screen, drawn from data the page has already fetched. */
export function OverviewView({
  name,
  isAdmin,
  today,
  week,
  stats,
  away,
  tracked,
  onShift,
  alerts,
  photos,
}: OverviewData) {
  const weekTotal = week.reduce((s, d) => s + d.onTime + d.late, 0)
  const weekLate = week.reduce((s, d) => s + d.late, 0)
  const yesterday = week.length > 1 ? week[week.length - 2].onTime + week[week.length - 2].late : 0
  const total = stats.staff_total ?? 0
  const clockedIn = stats.clocked_in ?? 0
  const pct = (n: number | undefined, of = total) => (of ? Math.round(((n ?? 0) / of) * 100) : 0)
  const change = yesterday ? Math.round(((clockedIn - yesterday) / yesterday) * 100) : null
  const avgCoverage = tracked.length
    ? Math.round(tracked.reduce((s, r) => s + (r.coverage_pct ?? 0), 0) / tracked.length)
    : 0
  const lowest = [...tracked]
    .sort((a, b) => (a.coverage_pct ?? 0) - (b.coverage_pct ?? 0))
    .slice(0, 4)

  const actions: { href: string; label: string; icon: LucideIcon }[] = [
    { href: '/admin/users', label: 'Staff', icon: Users },
    isAdmin
      ? { href: '/admin/teams', label: 'Teams', icon: UsersRound }
      : { href: '/admin/assignments', label: 'Stores', icon: UsersRound },
    { href: '/admin/tracking', label: 'Movement', icon: Route },
    { href: '/admin/alerts', label: 'Alerts', icon: Bell },
    { href: '/admin/attendance', label: 'More', icon: MoreHorizontal },
  ]

  const tip =
    (stats.absent ?? 0) > 0
      ? {
          title: `${stats.absent} ${stats.absent === 1 ? 'person has' : 'people have'} not clocked in yet`,
          body: 'They are assigned to a store today. A quick call usually settles it before the morning is gone.',
          href: '#not-clocked-in',
          cta: 'See who',
        }
      : (stats.open_alerts ?? 0) > 0
        ? {
            title: `${stats.open_alerts} open alert${stats.open_alerts === 1 ? '' : 's'} to look at`,
            body: 'Someone left their store or clocked in away from it. Check and resolve each one.',
            href: '/admin/alerts',
            cta: 'Review alerts',
          }
        : {
            title: 'Everyone assigned is in',
            body: 'Nobody is missing and there are no open alerts. Store counts and visits are worth a look.',
            href: '/admin/store-counts',
            cta: 'Store counts',
          }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting()}, {name.split(/\s+/)[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {day(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · updated{' '}
          {formatLagos(new Date(), false)}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-5">
          {/* Attendance: the week's chart, with today's figures beside it. */}
          <section className="surface flex flex-col md:flex-row">
            <div className="min-w-0 flex-1 p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">{clockedIn}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    clocked in today · {weekTotal} this week, {weekLate} late
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold">
                    Last 7 days
                  </span>
                  <span className="flex gap-3 text-xs text-muted-foreground">
                    <Legend colour={ON_TIME} label="On time" />
                    <Legend colour={LATE} label="Late" />
                  </span>
                </div>
              </div>
              <AttendanceChart days={week} />
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-border p-5 sm:p-6 md:w-60 md:grid-cols-1 md:content-center md:gap-8 md:border-l md:border-t-0">
              <Figure
                label="Clocked in"
                value={clockedIn}
                note={
                  change === null ? `${pct(clockedIn)}% of staff` : `${Math.abs(change)}% vs yesterday`
                }
                trend={change === null ? null : change >= 0 ? 'up' : 'down'}
                good={change === null || change >= 0}
              />
              <Figure
                label="Late"
                value={stats.late ?? 0}
                note={`${pct(stats.late, clockedIn)}% of clock-ins`}
                good={!stats.late}
              />
              <Figure
                label="Not in store"
                value={stats.off_site ?? 0}
                note={`${stats.open_alerts ?? 0} open alert${stats.open_alerts === 1 ? '' : 's'}`}
                good={!stats.off_site}
              />
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Clock-in progress, as the reference's spending limit. */}
            <section className="surface p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Clock-ins today</h2>
              <p className="text-xs text-muted-foreground">Of everyone assigned to a store</p>
              <div className="mt-5 flex h-8 w-full gap-1 overflow-hidden rounded-lg bg-muted">
                <span
                  className="hatch block h-full rounded-lg"
                  style={{ width: `${pct(clockedIn)}%`, background: ON_TIME, minWidth: clockedIn ? 8 : 0 }}
                />
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="font-semibold tabular-nums">{clockedIn} in</span>
                <span className="tabular-nums text-muted-foreground">{total} staff</span>
              </div>
            </section>

            {/* One thing worth doing next, as the reference's quick tip. */}
            <section className="surface relative overflow-hidden p-5 sm:p-6">
              <div className="relative z-10 max-w-[75%]">
                <h2 className="text-lg font-semibold leading-snug">{tip.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{tip.body}</p>
                <Link
                  href={tip.href}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold hover:text-brand"
                >
                  {tip.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <Blocks />
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            <section className="surface p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Where everyone is</h2>
              <p className="text-xs text-muted-foreground">Right now, of {total} staff</p>
              <p className="my-4 text-3xl font-bold tabular-nums tracking-tight">
                {stats.still_on_shift ?? 0}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">on shift</span>
              </p>
              <SegmentBar
                of={total}
                parts={[
                  { label: 'On shift now', value: stats.still_on_shift ?? 0, colour: ON_TIME },
                  { label: 'Clocked out', value: stats.clocked_out ?? 0, colour: LATE },
                  { label: 'Not clocked in', value: stats.absent ?? 0, colour: NOT_IN },
                ]}
              />
            </section>

            <section className="surface flex flex-col p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Location coverage</h2>
              <p className="text-xs text-muted-foreground">Today, people on shift</p>
              <p className="my-4 text-3xl font-bold tabular-nums tracking-tight">
                {tracked.length}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">tracked</span>
              </p>
              <div className="flex flex-1 items-end">
                <Gauge pct={avgCoverage} label="of shift time located" />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                The average share of each shift in which the phone reported where it was.
              </p>
            </section>

            <section className="surface p-5 sm:p-6 lg:col-span-2 2xl:col-span-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Least located</h2>
                  <p className="text-xs text-muted-foreground">Lowest coverage first</p>
                </div>
                <Link
                  href="/admin/tracking"
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-tint"
                >
                  Map
                </Link>
              </div>
              {lowest.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">Nobody has clocked in yet.</p>
              ) : (
                <ul className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
                  {lowest.map((row) => {
                    const c = row.coverage_pct ?? 0
                    return (
                      <li key={row.user_id} className="flex items-center gap-3">
                        <Avatar name={row.full_name} />
                        <div className="min-w-0 flex-1">
                          <p className="flex justify-between gap-2 text-sm">
                            <span className="truncate font-medium">{row.full_name}</span>
                            <span className="shrink-0 font-semibold tabular-nums">{c}%</span>
                          </p>
                          <span className="mt-1 block h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <span
                              className="hatch block h-full rounded-full"
                              style={{ width: `${Math.max(3, c)}%`, background: c >= 70 ? ON_TIME : LATE }}
                            />
                          </span>
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">
                            {row.outlet_name ?? 'No outlet'}
                            {row.last_ping_at && ` · last seen ${formatLagos(row.last_ping_at, false)}`}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>

        {/* Right column */}
        <div className="min-w-0 space-y-5">
          <section className="surface p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Today</h2>
                <p className="text-xs text-muted-foreground">Quick actions</p>
              </div>
              <Link
                href="/admin/users?new=1"
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-tint"
              >
                + Add staff
              </Link>
            </div>

            <div className="brand-surface relative mt-4 overflow-hidden p-5">
              <span aria-hidden className="hatch pointer-events-none absolute inset-0 opacity-60" />
              <p className="text-xs text-white/80">{day(today, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
              <p className="mt-6 text-4xl font-bold tabular-nums">{stats.still_on_shift ?? 0}</p>
              <p className="text-sm text-white/85">on shift right now</p>
              <div className="mt-5 flex items-end justify-between text-xs text-white/85">
                <span>
                  {clockedIn} of {total} clocked in
                </span>
                <span className="font-bold tracking-wide text-white">XTEND</span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-5 gap-2">
              {actions.map((a) => (
                <Link key={a.href} href={a.href} className="group flex flex-col items-center gap-1.5 text-center">
                  <span className="flex h-12 w-full max-w-[3.25rem] items-center justify-center rounded-xl border border-border bg-card transition-colors group-hover:border-brand/40 group-hover:bg-tint">
                    <a.icon className="h-5 w-5" />
                  </span>
                  <span className="text-[11px] font-medium">{a.label}</span>
                </Link>
              ))}
            </div>

            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold">On shift now</p>
              {onShift.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nobody is on shift yet.</p>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {onShift.slice(0, 5).map((p) => (
                    <Link
                      key={p.user_id}
                      href={`/admin/tracking?person=${p.user_id}`}
                      className="flex min-w-0 flex-col items-center gap-1.5"
                      title={p.full_name}
                    >
                      <Avatar name={p.full_name} size="lg" ring={p.inside_geofence === false} />
                      <span className="w-full truncate text-center text-[11px]">
                        {p.full_name.split(/\s+/)[0]}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {onShift.length > 5 && (
                <Link href="/admin/tracking" className="mt-3 block text-xs font-semibold text-brand">
                  and {onShift.length - 5} more on the map
                </Link>
              )}
            </div>
          </section>

          <LiveAlertFeed initial={alerts} />
        </div>
      </div>

      <LiveLocations rows={onShift} />

      <section id="not-clocked-in" className="surface scroll-mt-24 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Not clocked in ({away.length})</h2>
        <p className="text-xs text-muted-foreground">Assigned to a store today, with no clock-in yet</p>
        {away.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Everyone assigned has clocked in.</p>
        ) : (
          <ul className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {away.map((person) => (
              <li key={person.user_id} className="flex items-center gap-3 border-b border-border py-2.5 text-sm">
                <Avatar name={person.full_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{person.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.outlet_name ?? 'No outlet assigned'}
                  </span>
                </span>
                {person.phone && (
                  <a
                    href={`tel:${person.phone}`}
                    aria-label={`Call ${person.full_name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-tint"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {photos && (
        <p className="text-xs text-muted-foreground">
          Clock photos are deleted 24 hours after they are taken — {photos.photos_held} held
          right now
          {photos.overdue > 0 && `, ${photos.overdue} due to go on the next sweep`}
          {photos.last_run_at &&
            ` · last swept ${formatLagos(photos.last_run_at, false)}, ${
              photos.last_result?.photos_deleted ?? 0
            } removed`}
          .
        </p>
      )}
    </div>
  )
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colour }} />
      {label}
    </span>
  )
}

function Figure({
  label,
  value,
  note,
  good,
  trend,
}: {
  label: string
  value: number
  note: string
  good: boolean
  trend?: 'up' | 'down' | null
}) {
  const Arrow = trend === 'down' ? ArrowDownRight : ArrowUpRight
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">{value}</p>
      <p className={cn('mt-1 flex items-center gap-1 text-[11px] sm:text-xs', good ? 'text-success' : 'text-brand')}>
        {trend && <Arrow className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{note}</span>
      </p>
    </div>
  )
}

function Avatar({ name, size = 'md', ring }: { name: string; size?: 'md' | 'lg'; ring?: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-tint font-bold text-tint-foreground',
        size === 'lg' ? 'h-12 w-12 text-sm' : 'h-10 w-10 text-xs',
        ring && 'ring-2 ring-brand ring-offset-2 ring-offset-card',
      )}
    >
      {initials(name)}
    </span>
  )
}

/** The stepped block pattern in the corner of the reference's tip card. */
function Blocks() {
  const cells = [
    [3, 0, 'a'], [2, 1, 'b'], [3, 1, 'c'], [1, 2, 'c'], [2, 2, 'a'], [3, 2, 'a'],
    [0, 3, 'c'], [1, 3, 'b'], [2, 3, 'c'], [3, 3, 'a'],
  ] as const
  const fill = { a: ON_TIME, b: LATE, c: 'hsl(var(--tint))' }
  return (
    <div aria-hidden className="absolute bottom-4 right-4 grid grid-cols-4 gap-1 opacity-90">
      {Array.from({ length: 16 }, (_, i) => {
        const x = i % 4
        const y = Math.floor(i / 4)
        const cell = cells.find(([cx, cy]) => cx === x && cy === y)
        return (
          <span
            key={i}
            className={cn('h-6 w-6 rounded-md', cell && cell[2] !== 'c' && 'hatch')}
            style={{ background: cell ? fill[cell[2]] : 'transparent', opacity: cell?.[2] === 'a' ? 0.85 : 1 }}
          />
        )
      })}
    </div>
  )
}
