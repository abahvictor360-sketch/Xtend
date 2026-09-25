import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LiveAlertFeed } from '@/components/admin/live-alert-feed'
import { LiveLocations, type LiveLocation } from '@/components/admin/live-locations'
import { WeekChart, TodaySplit, type DayCount } from '@/components/admin/overview-charts'
import { addDays, cn, formatLagos, lagosDateString } from '@/lib/utils'
import {
  AlertTriangle,
  Clock,
  LogIn,
  MapPinOff,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import type { AlertDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Overview — Xtend' }

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

export default async function AdminOverview() {
  await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  const [
    { data: overview },
    { data: absentees },
    { data: coverage },
    { data: live },
    { data: alerts },
    { data: retention },
  ] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.rpc('absentees_today'),
    supabase.rpc('coverage_today'),
    supabase.rpc('live_locations'),
    supabase
      .from('alert_detail')
      .select('*')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.rpc('selfie_retention_status'),
  ])

  // The last seven days of clock-ins, on time and late, for the chart.
  const today = lagosDateString()
  const weekStart = addDays(today, -6)
  const { data: openings } = await supabase
    .from('attendance_detail')
    .select('attendance_date, is_late')
    .eq('type', 'opening')
    .gte('attendance_date', weekStart)
    .lte('attendance_date', today)
    .limit(5000)
  const week: DayCount[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const rows = ((openings ?? []) as { attendance_date: string; is_late: boolean }[]).filter(
      (r) => r.attendance_date === date,
    )
    return {
      date,
      label: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short' }),
      onTime: rows.filter((r) => !r.is_late).length,
      late: rows.filter((r) => r.is_late).length,
    }
  })
  const weekTotal = week.reduce((s, d) => s + d.onTime + d.late, 0)
  const weekLate = week.reduce((s, d) => s + d.late, 0)

  const stats = (overview ?? {}) as Partial<Overview>
  const away = (absentees ?? []) as Absentee[]
  const tracked = (coverage ?? []) as CoverageRow[]
  const photos = retention as {
    last_run_at: string | null
    last_result: { photos_deleted?: number; at?: string } | null
    photos_held: number
    overdue: number
  } | null

  const total = stats.staff_total ?? 0
  const pct = (n: number | undefined) => (total ? Math.round(((n ?? 0) / total) * 100) : 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Today&apos;s attendance</h1>
          <p className="text-sm text-muted-foreground">
            {stats.date ?? '—'} · Africa/Lagos · updated {formatLagos(new Date(), false)}
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <StatCard
              featured
              icon={LogIn}
              label="Clocked in"
              value={stats.clocked_in}
              note={`of ${total} staff`}
              badge={`${pct(stats.clocked_in)}%`}
            />
            <StatCard
              icon={Clock}
              label="Late"
              value={stats.late}
              note="after their shift start"
              badge={stats.late ? `${pct(stats.late)}%` : 'None'}
              tone={stats.late ? 'warn' : 'good'}
            />
            <StatCard
              icon={UserX}
              label="Not clocked in"
              value={stats.absent}
              note="assigned but no clock-in"
              badge={stats.absent ? `${pct(stats.absent)}%` : 'None'}
              tone={stats.absent ? 'bad' : 'good'}
            />
            <StatCard
              icon={MapPinOff}
              label="Not in store"
              value={stats.off_site}
              note="clocked in off site"
              badge={stats.open_alerts ? `${stats.open_alerts} alerts` : 'No alerts'}
              tone={stats.off_site ? 'bad' : 'good'}
            />
          </div>

          <div className="surface p-5">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">Clock-ins this week</h2>
              <span className="text-xs text-muted-foreground">Last 7 days</span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {weekTotal} clock-ins, {weekLate} late
              {weekTotal ? ` (${Math.round((weekLate / weekTotal) * 100)}%)` : ''}
            </p>
            <WeekChart days={week} />
          </div>
        </div>

        <div className="surface bg-gradient-to-b from-tint to-card p-5">
          <h2 className="text-lg font-bold">Where everyone is</h2>
          <p className="mb-5 text-sm text-muted-foreground">Today, of {total} staff</p>
          <TodaySplit
            centreLabel="staff today"
            parts={[
              { label: 'On shift now', value: stats.still_on_shift ?? 0 },
              { label: 'Clocked out', value: stats.clocked_out ?? 0 },
              { label: 'Not clocked in', value: stats.absent ?? 0 },
            ]}
          />
          {Boolean(stats.open_alerts) && (
            <a
              href="/admin/alerts"
              className="mt-5 flex items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm font-semibold shadow-soft hover:bg-tint"
            >
              <AlertTriangle className="h-4 w-4 text-brand" />
              {stats.open_alerts} open alert{stats.open_alerts === 1 ? '' : 's'} to look at
            </a>
          )}
        </div>
      </div>

      <LiveLocations rows={(live ?? []) as LiveLocation[]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Not clocked in ({away.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {away.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everyone assigned has clocked in.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {away.map((person) => (
                  <li key={person.user_id} className="flex items-center justify-between py-2">
                    <span>
                      {person.full_name}
                      <span className="block text-xs text-muted-foreground">
                        {person.outlet_name ?? 'No outlet assigned'}
                      </span>
                    </span>
                    {person.phone && (
                      <a href={`tel:${person.phone}`} className="text-xs text-primary">
                        {person.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <LiveAlertFeed initial={(alerts ?? []) as AlertDetail[]} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Location tracking today ({tracked.length} on shift)</CardTitle>
          </CardHeader>
          <CardContent>
            {tracked.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has clocked in yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {tracked.map((row) => (
                  <li key={row.user_id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{row.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.outlet_name ?? 'No outlet'} · {row.ping_count} check
                        {row.ping_count === 1 ? '' : 's'}
                        {row.last_ping_at && ` · last ${formatLagos(row.last_ping_at, false)}`}
                      </span>
                    </span>
                    <span className="w-28 shrink-0">
                      <span className="block h-2 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className={
                            (row.coverage_pct ?? 0) >= 70
                              ? 'block h-full rounded-full bg-success'
                              : 'block h-full rounded-full bg-warning'
                          }
                          style={{ width: `${Math.max(2, row.coverage_pct ?? 0)}%` }}
                        />
                      </span>
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">
                      {row.coverage_pct ?? 0}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

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

function StatCard({
  icon: Icon,
  label,
  value,
  note,
  badge,
  tone,
  featured,
}: {
  icon: LucideIcon
  label: string
  value: number | undefined
  note: string
  badge: string
  tone?: 'good' | 'warn' | 'bad'
  featured?: boolean
}) {
  return (
    <div className={cn('p-4 sm:p-5', featured ? 'brand-surface shadow-lift' : 'surface')}>
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-2xl sm:h-11 sm:w-11',
            featured ? 'bg-white/20 text-white' : 'bg-tint text-brand',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-bold',
            featured
              ? 'bg-white text-brand-deep'
              : tone === 'bad'
                ? 'bg-destructive/10 text-destructive'
                : tone === 'warn'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-success/15 text-success',
          )}
        >
          {badge}
        </span>
      </div>
      <p className={cn('mt-3 text-sm font-medium sm:mt-4', featured ? 'text-white/85' : 'text-muted-foreground')}>
        {label}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-extrabold tabular-nums tracking-tight sm:text-4xl">{value ?? 0}</span>
        <span className={cn('text-xs', featured ? 'text-white/80' : 'text-muted-foreground')}>{note}</span>
      </div>
    </div>
  )
}
