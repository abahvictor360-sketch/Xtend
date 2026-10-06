import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { AlertsList } from '@/components/admin/alerts-list'
import { PushToggle } from '@/components/field/push-toggle'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { flagHeadline } from '@/lib/flag-labels'
import { cn, formatLagos } from '@/lib/utils'
import type { AlertDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Alerts — Xtend' }

type Tab = 'location' | 'activity' | 'resolved'

/** The tabs look like the app's filter chips; they are links, so pages can be bookmarked. */
const chip = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold transition-all',
    active ? 'bg-brand text-primary-foreground shadow-lift' : 'bg-tint text-tint-foreground hover:brightness-95',
  )

interface FlagRow {
  id: string
  staff_name: string
  kind: string
  severity: 'medium' | 'high'
  summary: string
  outlet_name: string | null
  created_at: string
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const { show } = await searchParams
  const tab: Tab = show === 'resolved' ? 'resolved' : show === 'activity' ? 'activity' : 'location'

  // RLS narrows all of it to a supervisor's own team.
  const supabase = await createServerSupabase()
  const [{ data: alerts }, { data: flags }, { count: openLocation }] = await Promise.all([
    tab === 'activity'
      ? Promise.resolve({ data: [] })
      : supabase
          .from('alert_detail')
          .select('*')
          .eq('is_resolved', tab === 'resolved')
          .order('created_at', { ascending: false })
          .limit(200),
    // Late in, early out and suspicious activity still to review (036).
    supabase
      .from('integrity_flag_detail')
      .select('id, staff_name, kind, severity, summary, outlet_name, created_at')
      .is('reviewed_at', null)
      .in('severity', ['medium', 'high'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('location_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('is_resolved', false),
  ])
  const activity = (flags ?? []) as FlagRow[]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          {session.profile.role === 'admin'
            ? 'Everything about every member of staff, newest first.'
            : 'Everything about your team, newest first.'}{' '}
          Every resolution is written to the audit log.
        </p>
      </div>

      <PushToggle
        title="Alerts on this device"
        hint="Turn this on to be told the moment somebody clocks in late, leaves their store or does something suspicious. Do it on each computer or phone you use."
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/alerts"
          aria-current={tab === 'location' ? 'page' : undefined}
          className={chip(tab === 'location')}
        >
          Location ({openLocation ?? 0})
        </Link>
        <Link
          href="/admin/alerts?show=activity"
          aria-current={tab === 'activity' ? 'page' : undefined}
          className={chip(tab === 'activity')}
        >
          Late &amp; suspicious ({activity.length})
        </Link>
        <Link
          href="/admin/alerts?show=resolved"
          aria-current={tab === 'resolved' ? 'page' : undefined}
          className={chip(tab === 'resolved')}
        >
          Resolved
        </Link>
      </div>

      {tab === 'activity' ? (
        activity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nothing late or suspicious waiting to be reviewed.
          </p>
        ) : (
          <div className="space-y-2">
            {activity.map((flag) => (
              <Card key={flag.id}>
                <CardContent className="flex flex-col gap-2 p-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {flag.staff_name}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {flag.outlet_name ?? 'No outlet'}
                      </span>
                    </p>
                    <p className="text-sm first-letter:uppercase">{flagHeadline(flag.kind)}</p>
                    <p className="text-xs text-muted-foreground">
                      {flag.summary} · {formatLagos(flag.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={flag.severity === 'high' ? 'destructive' : 'warning'}>
                      {flag.severity}
                    </Badge>
                    <Link
                      href="/admin/integrity"
                      className="text-sm font-semibold text-brand underline-offset-2 hover:underline"
                    >
                      Review
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <AlertsList
          alerts={(alerts ?? []) as AlertDetail[]}
          resolved={tab === 'resolved'}
          canResolve={session.profile.role === 'admin'}
        />
      )}
    </div>
  )
}
