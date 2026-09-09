'use client'

import { useRouter } from 'next/navigation'
import { MapPin, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { LocationGate } from '@/components/field/location-gate'
import { useLocationGate } from '@/components/field/use-location-gate'
import { useHeartbeat } from '@/components/field/heartbeat'
import { OutboxBanner } from '@/components/field/outbox-banner'
import { ClockPanel } from '@/components/field/clock-panel'
import { haversineMetres } from '@/lib/geo'
import { metres } from '@/lib/utils'
import type { DayState } from '@/lib/types'

export function FieldHome({ day }: { day: DayState }) {
  const router = useRouter()
  const gate = useLocationGate()
  const onShift = Boolean(day.opening) && !day.closing
  useHeartbeat(onShift && gate.status === 'ready')

  const liveDistance =
    gate.fix && day.outlet
      ? haversineMetres(gate.fix.lat, gate.fix.lng, day.outlet.lat, day.outlet.lng)
      : null

  return (
    <div className="space-y-4">
      <OutboxBanner onFlushed={() => router.refresh()} />

      {day.outlet && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 pt-4">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate font-medium">{day.outlet.name}</p>
              <p className="text-sm text-muted-foreground">
                Shift {day.outlet.shift_start.slice(0, 5)} – {day.outlet.shift_end.slice(0, 5)} ·
                geofence {day.outlet.radius_m} m
              </p>
              {liveDistance !== null && (
                <p className="mt-1 text-sm">
                  You are{' '}
                  <span
                    className={
                      liveDistance <= day.outlet.radius_m ? 'font-medium text-success' : 'font-medium text-destructive'
                    }
                  >
                    {metres(liveDistance)}
                  </span>{' '}
                  from the outlet
                  {gate.fix && ` (fix accurate to ${Math.round(gate.fix.accuracy_m)} m)`}.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <LocationGate
        status={gate.status}
        reason={gate.reason}
        message={gate.message}
        onRetry={() => void gate.retry()}
      >
        <ClockPanel day={day} />
      </LocationGate>

      {onShift && (
        <Alert className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-sm text-muted-foreground">
            While Xtend is open on screen, your location is checked every 5 minutes. It stops when
            you close or switch away from the app. A browser cannot track you in the background and
            Xtend does not claim to.
          </span>
        </Alert>
      )}
    </div>
  )
}
