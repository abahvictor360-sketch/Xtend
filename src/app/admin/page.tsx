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

interface Absentee {
  user_id: string
  full_name: string
  phone: string | null
  outlet_name: string | null
}

export default async function AdminOverview() {
  await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  const [{ data: overview }, { data: absentees }, { data: alerts }] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.rpc('absentees_today'),
    supabase
      .from('alert_detail')
      .select('*')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const stats = (overview ?? {}) as Partial<Overview>
  const away = (absentees ?? []) as Absentee[]

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
