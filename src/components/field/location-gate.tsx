'use client'

import { useEffect, useRef } from 'react'
import { LocateFixed, MapPinOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LocationHelp, useLocationPermission } from '@/components/field/location-help'
import type { GateStatus } from '@/components/field/use-location-gate'
import type { GeoBlockReason } from '@/lib/geo'

const HELP: Record<GeoBlockReason, string> = {
  permission_denied:
    'Location permission is off for Xtend. Turn it on and this screen will clear itself.',
  position_unavailable:
    'Turn phone Location on, set it to High accuracy, and step outside or near a window.',
  low_accuracy:
    'Your phone is guessing from cell towers. Turn on high-accuracy GPS and wait a few seconds outdoors.',
  unsupported: 'Open Xtend in Chrome. This browser cannot report location.',
}

export function LocationGate({
  status,
  reason,
  message,
  onRetry,
  children,
}: {
  status: GateStatus
  reason: GeoBlockReason | null
  message: string | null
  onRetry: () => void
  children: React.ReactNode
}) {
  const permission = useLocationPermission()
  const wasBlocked = useRef(false)

  // Somebody who goes into Settings and allows location should come back to
  // a working screen, not to the same error and another button to press.
  useEffect(() => {
    if (status === 'blocked') wasBlocked.current = true
    if (permission === 'granted' && wasBlocked.current && status === 'blocked') {
      wasBlocked.current = false
      onRetry()
    }
  }, [permission, status, onRetry])

  if (status === 'checking') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-brand">
          <LocateFixed className="h-4 w-4 animate-pulse" />
          Getting your location…
        </div>
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (status === 'blocked') {
    return (
      <Card className="animate-fade-up border border-destructive/20">
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="icon-tile bg-destructive/10 text-destructive">
              <MapPinOff className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold">Location required</p>
              <p className="mt-1 text-sm text-muted-foreground">{message}</p>
            </div>
          </div>

          {reason && (
            <p className="rounded-2xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
              {HELP[reason]}
            </p>
          )}

          <LocationHelp
            permission={reason === 'permission_denied' ? 'denied' : permission}
            onRetry={onRetry}
          />

        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}
