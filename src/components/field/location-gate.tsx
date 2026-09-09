'use client'

import { LocateFixed, MapPinOff, RefreshCw } from 'lucide-react'
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

          <p className="text-[11px] text-muted-foreground">
            This attempt was logged. Your admin can see that you opened Xtend without a location fix.
          </p>

          <Button className="w-full" size="lg" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}
