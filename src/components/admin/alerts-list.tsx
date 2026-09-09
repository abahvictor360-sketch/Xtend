'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { formatLagos, metres } from '@/lib/utils'
import type { AlertDetail } from '@/lib/types'

const LABEL: Record<string, string> = {
  left_geofence: 'Left the store during their shift',
  low_accuracy: 'Location fix too rough to trust',
  permission_denied: 'Tried to open Xtend with location off',
  off_site_clock: 'Clocked in or out away from the store',
}

export function AlertsList({
  alerts,
  resolved,
  canResolve,
}: {
  alerts: AlertDetail[]
  resolved: boolean
  canResolve: boolean
}) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resolve(id: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/alerts/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: notes[id] ?? '' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not resolve that alert.')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {resolved ? 'Resolved alerts.' : 'Unresolved alerts, newest first.'} Every resolution is
            written to the audit log.
          </p>
        </div>
        <Link
          href={resolved ? '/admin/alerts' : '/admin/alerts?show=resolved'}
          className="text-sm text-primary"
        >
          {resolved ? 'Show unresolved' : 'Show resolved'}
        </Link>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {alerts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {resolved ? 'Nothing resolved yet.' : 'No open alerts.'}
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <Card key={alert.id}>
              <CardContent className="flex flex-col gap-3 p-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    {alert.staff_name}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {alert.outlet_name ?? 'No outlet'}
                    </span>
                  </p>
                  <p className="text-sm">{LABEL[alert.alert_type] ?? alert.alert_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatLagos(alert.created_at)}
                    {alert.distance_m !== null && ` · ${metres(alert.distance_m)}`}
                  </p>
                  {alert.is_resolved && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Resolved by {alert.resolved_by_name ?? 'an admin'}{' '}
                      {formatLagos(alert.resolved_at)}
                      {alert.note ? ` — “${alert.note}”` : ''}
                    </p>
                  )}
                </div>

                {!alert.is_resolved && canResolve && (
                  <div className="flex w-full shrink-0 gap-2 sm:w-80">
                    <Input
                      placeholder="Resolution note"
                      value={notes[alert.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [alert.id]: e.target.value }))}
                    />
                    <Button onClick={() => resolve(alert.id)} disabled={busy === alert.id}>
                      {busy === alert.id ? '…' : 'Resolve'}
                    </Button>
                  </div>
                )}

                {!alert.is_resolved && !canResolve && <Badge variant="outline">Open</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
