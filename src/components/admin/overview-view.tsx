import Link from 'next/link'
import { ArrowRight, BarChart3, Bell, CalendarDays, MapPin, Phone, Radar, UserX, Users } from 'lucide-react'
import { Chip, SectionTitle, StatCard, StatGrid } from '@/components/admin/page-kit'
import { LiveAlertFeed } from '@/components/admin/live-alert-feed'
import { LiveLocations, type LiveLocation } from '@/components/admin/live-locations'
import { AttendanceChart, ON_TIME, LATE, type DayCount } from '@/components/admin/overview-charts'
import { TZ, cn, formatLagos, lagosDateString } from '@/lib/utils'
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
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-brand">{isAdmin ? 'Company overview' : 'Your team'}</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{greeting()}, {name.split(/\s+/)[0]}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Today at a glance. Lagos time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip icon={CalendarDays}>{day(today, { weekday: 'long', day: 'numeric', month: 'long' })}</Chip>
          <Chip icon={Users}>{total} staff</Chip>
        </div>
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
      <section aria-label="Today's summary">
        <StatGrid>
          <StatCard
            icon={Users}
            label="Clocked in today"
            value={available ? String(stats.clocked_in ?? 0) : '—'}
            tone="good"
            note={available ? `of ${total} staff · ${stats.late ?? 0} late` : 'Currently unavailable'}
            bar={total ? ((stats.clocked_in ?? 0) / total) * 100 : null}
            href="/admin/attendance"
          />
          <StatCard
            icon={MapPin}
            label="On shift now"
            value={available ? String(stats.still_on_shift ?? 0) : '—'}
            note={`${stats.off_site ?? 0} away from their store`}
            href="/admin/tracking"
          />
          <StatCard
            icon={UserX}
            label="Not clocked in"
            value={available ? String(missing) : '—'}
            tone={missing ? 'bad' : 'muted'}
            note={missing ? 'Assigned to work today' : 'Nobody missing'}
            bar={total ? (missing / total) * 100 : null}
            href="#not-clocked-in"
          />
          <StatCard
            icon={Bell}
            label="Open alerts"
            value={available ? String(openAlerts) : '—'}
            tone={openAlerts ? 'warn' : 'muted'}
            note={openAlerts ? 'Review and follow up' : 'All clear'}
            href="/admin/alerts"
          />
        </StatGrid>
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="surface min-w-0 border border-border p-5 sm:p-6">
          <div className="mb-6">
            <SectionTitle icon={BarChart3} title="Attendance this week" note={`${weekTotal} clock-ins over the last 7 days`}>
              <div className="flex gap-3 text-xs text-muted-foreground"><Legend colour={ON_TIME} label="On time" /><Legend colour={LATE} label="Late" /></div>
            </SectionTitle>
          </div>
          <AttendanceChart days={week} />
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-sm"><span><strong>{stats.late ?? '—'}</strong> late today</span><span><strong>{stats.clocked_out ?? '—'}</strong> clocked out</span></div>
        </section>
        <LiveAlertFeed initial={alerts} />
      </div>
      <section id="not-clocked-in" className="surface scroll-mt-40 border border-border p-5 sm:p-6">
        <SectionTitle
          icon={UserX}
          tone={away.length ? 'bad' : 'muted'}
          title="Attendance follow-up"
          note={`Assigned today, with no clock-in yet · ${away.length} ${away.length === 1 ? 'person' : 'people'}`}
        >
          <Link href="/admin/attendance" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand">View attendance <ArrowRight className="h-4 w-4" /></Link>
        </SectionTitle>
        {away.length === 0 ? <p className="mt-5 rounded-xl bg-muted p-4 text-sm text-muted-foreground">No missing clock-ins in the records returned.</p> : (
          <ul className="mt-4 grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
            {away.map(person => <li key={person.user_id} className="flex items-center gap-3 border-t border-border py-4">
              <Avatar name={person.full_name} />
              <div className="min-w-0 flex-1"><Link href={'/admin/attendance/day?person=' + person.user_id + '&date=' + lagosDateString()} className="break-words text-sm font-semibold text-brand hover:underline">{person.full_name}</Link><p className="text-xs text-muted-foreground">{person.outlet_name ?? 'No outlet assigned'}</p></div>
              {person.phone && <a href={'tel:' + person.phone} aria-label={'Call ' + person.full_name} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border hover:bg-tint"><Phone className="h-4 w-4" /></a>}
            </li>)}
          </ul>
        )}
      </section>
      <details className="surface border border-border p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand"><Radar className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold leading-tight">Live locations &amp; coverage</span>
            <span className="block text-xs text-muted-foreground">{onShift.length} on the map · tap to open</span>
          </span>
        </summary>
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
