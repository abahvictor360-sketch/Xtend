'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatLagos, metres } from '@/lib/utils'
import type { AlertDetail } from '@/lib/types'

const LABEL: Record<string, string> = {
  left_geofence: 'Left the store during their shift',
  low_accuracy: 'Location too rough to verify',
  permission_denied: 'Opened Xtend with location off',
  off_site_clock: 'Clocked in or out away from the store',
}

/** Realtime feed. New alerts arrive without a refresh. */
export function LiveAlertFeed({ initial }: { initial: AlertDetail[] }) {
  const [alerts, setAlerts] = useState(initial)

  useEffect(() => {
    const client = supabase()
    const channel = client
      .channel('alerts-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'location_alerts' },
        async (payload) => {
          const id = (payload.new as { id: string }).id
          // The realtime payload is the raw row; re-read the view so the feed
          // shows the staff name rather than a bare uuid.
          const { data } = await client.from('alert_detail').select('*').eq('id', id).maybeSingle()
          if (data) setAlerts((current) => [data as AlertDetail, ...current].slice(0, 20))
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg font-semibold">Open alerts</CardTitle>
        <Link
          href="/admin/alerts"
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-tint"
        >
          Review all
        </Link>
      </CardHeader>
      <CardContent>
        <p className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>Name</span>
          <span>When</span>
        </p>
        {alerts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing unresolved.</p>
        ) : (
          <ul className="space-y-3.5 text-sm">
            {alerts.slice(0, 8).map((alert) => (
              <li key={alert.id} className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
                  <Bell className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{alert.staff_name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {LABEL[alert.alert_type] ?? alert.alert_type}
                    {alert.distance_m !== null && ` · ${metres(alert.distance_m)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold tabular-nums">{formatLagos(alert.created_at, false)}</p>
                  <p className="text-[11px] text-brand">Open</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {alerts.length > 8 && (
          <Link href="/admin/alerts" className="mt-4 block text-xs font-semibold text-brand">
            {alerts.length - 8} more
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
