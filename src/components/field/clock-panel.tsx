'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { processSelfie } from '@/lib/image'
import { deviceInfo } from '@/lib/device'
import { requireFix, GeoBlocked, haversineMetres } from '@/lib/geo'
import { submitOrQueue, PermanentJobError } from '@/lib/offline/sync'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceType, DayState } from '@/lib/types'

interface Outcome {
  tone: 'success' | 'warning' | 'info'
  title: string
  detail: string
}

async function reverseGeocode(lat: number, lng: number) {
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
    if (!res.ok) return null
    const { address } = (await res.json()) as { address: string | null }
    return address
  } catch {
    return null
  }
}

export function ClockPanel({ day }: { day: DayState }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [pendingType, setPendingType] = useState<AttendanceType | null>(null)
  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const done = { opening: Boolean(day.opening), closing: Boolean(day.closing) }
  const nextType: AttendanceType | null = !done.opening ? 'opening' : !done.closing ? 'closing' : null

  const start = useCallback((type: AttendanceType) => {
    setError(null)
    setOutcome(null)
    setPendingType(type)
    inputRef.current?.click()
  }, [])

  const onSelfie = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      const type = pendingType
      setPendingType(null)
      if (!file || !type) return

      setError(null)
      try {
        // A fresh fix at the moment of capture, not the one from app open.
        setBusyStep('Checking your location…')
        const fix = await requireFix()

        setBusyStep('Compressing your selfie…')
        const { full, thumb } = await processSelfie(file)

        setBusyStep('Naming the place…')
        const address = await reverseGeocode(fix.lat, fix.lng)

        setBusyStep('Sending…')
        const result = await submitOrQueue({
          kind: 'clock',
          type,
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy_m,
          address,
          device_info: deviceInfo(),
          client_captured_at: fix.captured_at,
          selfie: full,
          thumb,
        })

        if (result.queued) {
          const guess =
            day.outlet && haversineMetres(fix.lat, fix.lng, day.outlet.lat, day.outlet.lng)
          setOutcome({
            tone: 'info',
            title: 'Saved on your phone',
            detail: `No data right now. This ${type === 'opening' ? 'clock-in' : 'clock-out'} is queued with the time and place it was taken (${formatLagos(fix.captured_at, false)}${
              guess ? `, about ${metres(guess)} from your outlet` : ''
            }) and will send itself when you get signal.`,
          })
        } else {
          const record = (result.data as { attendance: { status: string; distance_m: number | null } })
            .attendance
          // Tell them the truth, including when the truth is inconvenient.
          if (record.status === 'on_site') {
            setOutcome({
              tone: 'success',
              title: type === 'opening' ? 'Clocked in' : 'Clocked out',
              detail: `You were ${metres(record.distance_m)} from ${day.outlet?.name ?? 'your outlet'}. Inside the geofence, nothing flagged.`,
            })
          } else if (record.status === 'off_site') {
            setOutcome({
              tone: 'warning',
              title: `${type === 'opening' ? 'Clocked in' : 'Clocked out'} off site`,
              detail: `You were ${metres(record.distance_m)} from ${day.outlet?.name ?? 'your outlet'}, outside the ${day.outlet?.radius_m ?? 150} m geofence. This is recorded and your admin has been notified.`,
            })
          } else {
            setOutcome({
              tone: 'warning',
              title: 'Recorded, but flagged',
              detail:
                'Your location could not be verified against an outlet, or the fix was too rough. This is recorded and your admin has been notified.',
            })
          }
        }

        router.refresh()
      } catch (err) {
        if (err instanceof GeoBlocked) setError(err.message)
        else if (err instanceof PermanentJobError) setError(err.message)
        else setError(err instanceof Error ? err.message : 'That did not go through. Try again.')
      } finally {
        setBusyStep(null)
      }
    },
    [day.outlet, pendingType, router],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Today
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <ClockSlot label="Clock in" state={day.opening} />
          <ClockSlot label="Clock out" state={day.closing} />
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        {outcome && (
          <Alert variant={outcome.tone === 'success' ? 'success' : outcome.tone === 'warning' ? 'warning' : 'info'}>
            <p className="flex items-center gap-1.5 font-medium">
              {outcome.tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              {outcome.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{outcome.detail}</p>
          </Alert>
        )}

        {/* The selfie is mandatory and must come from the camera. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={onSelfie}
        />

        {nextType ? (
          <Button
            size="xl"
            className="w-full"
            disabled={Boolean(busyStep)}
            onClick={() => start(nextType)}
          >
            <Camera className="h-5 w-5" />
            {busyStep ?? (nextType === 'opening' ? 'Clock in with selfie' : 'Clock out with selfie')}
          </Button>
        ) : (
          <Alert variant="success">
            Your shift is complete for today. One clock-in and one clock-out per day.
          </Alert>
        )}

        {!day.outlet && (
          <Alert variant="warning">
            You have no outlet assigned, so distance cannot be checked and every clock event will be
            flagged. Ask your admin to assign your outlet.
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function ClockSlot({ label, state }: { label: string; state: DayState['opening'] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      {state ? (
        <>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatLagos(state.at, false)}</p>
          <Badge
            className="mt-1"
            variant={state.status === 'on_site' ? 'success' : 'destructive'}
          >
            {state.status === 'on_site' ? 'On site' : state.status === 'off_site' ? 'Off site' : 'Flagged'}
          </Badge>
        </>
      ) : (
        <p className="mt-1 text-lg font-semibold text-muted-foreground">—</p>
      )}
    </div>
  )
}
