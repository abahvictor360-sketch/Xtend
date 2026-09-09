'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Open alerts ({alerts.length})
        </CardTitle>
        <Link href="/admin/alerts" className="text-xs text-primary">
          Review all
        </Link>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing unresolved.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{alert.staff_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {LABEL[alert.alert_type] ?? alert.alert_type}
                    {alert.distance_m !== null && ` · ${metres(alert.distance_m)}`}
                  </p>
                </div>
                <Badge variant="outline">{formatLagos(alert.created_at, false)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
