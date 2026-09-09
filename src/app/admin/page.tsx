import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LiveAlertFeed } from '@/components/admin/live-alert-feed'
import { formatLagos } from '@/lib/utils'
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

  const [{ data: overview }, { data: absentees }, { data: coverage }, { data: alerts }] =
    await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.rpc('absentees_today'),
    supabase.rpc('coverage_today'),
    supabase
      .from('alert_detail')
      .select('*')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const stats = (overview ?? {}) as Partial<Overview>
  const away = (absentees ?? []) as Absentee[]
  const tracked = (coverage ?? []) as CoverageRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">
          {stats.date ?? '—'} · Africa/Lagos · updated {formatLagos(new Date(), false)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Clocked in" value={stats.clocked_in} of={stats.staff_total} />
        <Stat label="Still on shift" value={stats.still_on_shift} />
        <Stat label="Clocked out" value={stats.clocked_out} />
        <Stat label="Late" value={stats.late} tone={stats.late ? 'warn' : undefined} />
        <Stat label="Absent" value={stats.absent} tone={stats.absent ? 'bad' : undefined} />
        <Stat label="Off site" value={stats.off_site} tone={stats.off_site ? 'bad' : undefined} />
      </div>

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
    </div>
  )
}

function Stat({
  label,
  value,
  of,
  tone,
}: {
  label: string
  value: number | undefined
  of?: number
  tone?: 'warn' | 'bad'
}) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p
        className={
          tone === 'bad'
            ? 'stat-value text-destructive'
            : tone === 'warn'
              ? 'stat-value text-warning'
              : 'stat-value'
        }
      >
        {value ?? 0}
        {of !== undefined && <span className="text-base font-normal text-muted-foreground">/{of}</span>}
      </p>
    </div>
  )
}
