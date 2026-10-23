import Link from 'next/link'
import { ArrowRight, Bell, ClipboardList, MapPin, Phone, Users } from 'lucide-react'
import { LiveAlertFeed } from '@/components/admin/live-alert-feed'
import { LiveLocations, type LiveLocation } from '@/components/admin/live-locations'
import { AttendanceChart, ON_TIME, LATE, type DayCount } from '@/components/admin/overview-charts'
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


/** Priorities first, with detailed monitoring available below. */
export function OverviewView({ name, isAdmin, today, week, stats, away, tracked, onShift, alerts, photos }: OverviewData) {
  const total = stats.staff_total ?? 0
  const missing = stats.absent ?? 0
  const openAlerts = stats.open_alerts ?? 0
  const available = stats.staff_total !== undefined
  const weekTotal = week.reduce((sum, d) => sum + d.onTime + d.late, 0)
  const lowest = [...tracked].sort((a, b) => (a.coverage_pct ?? 0) - (b.coverage_pct ?? 0)).slice(0, 4)
  const metrics = [
    { label: 'Clocked in today', value: stats.clocked_in, note: total + ' staff in scope', href: '/admin/attendance', icon: Users },
    { label: 'On shift now', value: stats.still_on_shift, note: 'View current locations', href: '/admin/tracking', icon: MapPin },
    { label: 'Not clocked in', value: stats.absent, note: 'Assigned to work today', href: '#not-clocked-in', icon: ClipboardList },
    { label: 'Open alerts', value: stats.open_alerts, note: 'Review and follow up', href: '/admin/alerts', icon: Bell },
  ]
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-brand">{isAdmin ? 'Company overview' : 'Your team'}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{greeting()}, {name.split(/\s+/)[0]}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{day(today, { weekday: 'long', day: 'numeric', month: 'long' })} · Lagos time</p>
        </div>
        <Link href="/admin/attendance" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-tint">Attendance <ArrowRight className="h-4 w-4" /></Link>
      </header>
      <section className="rounded-2xl border border-brand/20 bg-tint p-5 sm:p-6" aria-labelledby="priority-heading">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-wider text-brand">Start here</p>
            <h2 id="priority-heading" className="mt-2 text-xl font-bold">{!available ? 'Today’s summary is unavailable' : openAlerts ? 'Review the alerts waiting for you' : missing ? 'Follow up on missing clock-ins' : total ? 'Today’s attendance is up to date' : 'Your workspace is ready'}</h2>
            <p className="mt-2 text-sm text-tint-foreground">{!available ? 'Open attendance to check the latest records.' : openAlerts ? openAlerts + ' open alerts. Check the details before taking action.' : missing ? missing + ' staff assigned today have not clocked in. Check their details below.' : total ? 'No missing clock-ins or open location alerts in this summary.' : 'Open Staff to review your people and store allocations.'}</p>
          </div>
          <Link href={!available ? '/admin/attendance' : openAlerts ? '/admin/alerts' : missing ? '#not-clocked-in' : '/admin/users'} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-deep">{!available ? 'Open attendance' : openAlerts ? 'Review alerts' : missing ? 'See staff' : 'View staff'} <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>
      <section aria-label="Today's summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(({ label, value, note, href, icon: Icon }) => (
          <Link key={label} href={href} className="surface group min-w-0 border border-border p-4 transition-colors hover:border-brand/40 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-2"><Icon className="h-5 w-5 text-brand" /><ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-brand" /></div>
            <p className="text-3xl font-bold tabular-nums tracking-tight">{value ?? '—'}</p>
            <h2 className="mt-1 text-sm font-semibold">{label}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{value === undefined ? 'Currently unavailable' : note}</p>
          </Link>
        ))}
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="surface min-w-0 border border-border p-5 sm:p-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold">Attendance this week</h2><p className="mt-1 text-sm text-muted-foreground">{weekTotal} clock-ins over the last 7 days</p></div>
            <div className="flex gap-3 text-xs text-muted-foreground"><Legend colour={ON_TIME} label="On time" /><Legend colour={LATE} label="Late" /></div>
          </div>
          <AttendanceChart days={week} />
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm"><span><strong>{stats.late ?? '—'}</strong> late today</span><span><strong>{stats.clocked_out ?? '—'}</strong> clocked out</span></div>
        </section>
        <LiveAlertFeed initial={alerts} />
      </div>
      <section id="not-clocked-in" className="surface scroll-mt-40 border border-border p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold">Attendance follow-up</h2><p className="mt-1 text-sm text-muted-foreground">Assigned today, with no clock-in yet · {away.length} {away.length === 1 ? 'person' : 'people'}</p></div>
          <Link href="/admin/attendance" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand">View attendance <ArrowRight className="h-4 w-4" /></Link>
        </div>
        {away.length === 0 ? <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">No missing clock-ins in the records returned.</p> : (
          <ul className="mt-4 grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
            {away.map(person => <li key={person.user_id} className="flex items-center gap-3 border-t border-border py-4">
              <Avatar name={person.full_name} />
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{person.full_name}</p><p className="text-xs text-muted-foreground">{person.outlet_name ?? 'No outlet assigned'}</p></div>
              {person.phone && <a href={'tel:' + person.phone} aria-label={'Call ' + person.full_name} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border hover:bg-tint"><Phone className="h-4 w-4" /></a>}
            </li>)}
          </ul>
        )}
      </section>
      <details className="surface border border-border p-5 sm:p-6">
        <summary className="cursor-pointer py-1 text-base font-bold">Live locations &amp; coverage <span className="ml-2 text-sm font-normal text-muted-foreground">{onShift.length} on the map</span></summary>
        <div className="mt-5 space-y-5">
          <LiveLocations rows={onShift} />
          <div><h2 className="font-semibold">Lowest location coverage</h2><p className="mt-1 text-sm text-muted-foreground">Share of shift time located. Open Movement for context.</p></div>
          {lowest.length ? <ul className="grid gap-3 sm:grid-cols-2">{lowest.map(row => <li key={row.user_id}><Link href={'/admin/tracking?person=' + row.user_id} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-muted p-3 text-sm"><span className="min-w-0 break-words">{row.full_name}</span><strong>{row.coverage_pct ?? 0}%</strong></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">No coverage records yet today.</p>}
        </div>
      </details>

      {photos && (
        <p className="text-xs text-muted-foreground">
          Clock photos are deleted 14 days after they are taken (admins and supervisors are told the day before) — {photos.photos_held} held
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
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />{label}</span>
}
function Avatar({
  name,
  size = 'md',
  ring,
  photo,
}: {
  name: string
  size?: 'md' | 'lg'
  ring?: boolean
  photo?: string | null
}) {
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt={name}
        className={cn(
          'shrink-0 rounded-xl object-cover',
          size === 'lg' ? 'h-12 w-12' : 'h-10 w-10',
          ring && 'ring-2 ring-brand ring-offset-2 ring-offset-card',
        )}
      />
    )
  }
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
