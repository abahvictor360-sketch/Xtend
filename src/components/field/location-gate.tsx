'use client'

import { MapPinOff, LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GateStatus } from '@/components/field/use-location-gate'
import type { GeoBlockReason } from '@/lib/geo'

const HELP: Record<GeoBlockReason, string> = {
  permission_denied:
    'Open your browser settings for this site and set Location to Allow, then tap retry.',
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
  if (status === 'checking') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LocateFixed className="h-4 w-4 animate-pulse" />
          Getting your location…
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (status === 'blocked') {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-4 p-4 pt-4">
          <div className="flex items-start gap-3">
            <MapPinOff className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Location required</p>
              <p className="mt-1 text-sm text-muted-foreground">{message}</p>
            </div>
          </div>
          {reason && <p className="text-sm text-muted-foreground">{HELP[reason]}</p>}
          <p className="text-xs text-muted-foreground">
            This attempt was logged. Your admin can see that you tried to open Xtend without a
            location fix.
          </p>
          <Button className="w-full" size="lg" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}
