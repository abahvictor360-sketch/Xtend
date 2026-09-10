'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, CheckCircle2, CloudUpload, LogIn, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CameraCapture } from '@/components/field/camera-capture'
import { Alert } from '@/components/ui/alert'
import { processSelfie } from '@/lib/image'
import { deviceInfo } from '@/lib/device'
import { requireFix, GeoBlocked, haversineMetres, type Fix } from '@/lib/geo'
import { submitOrQueue, PermanentJobError } from '@/lib/offline/sync'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceType, DayState } from '@/lib/types'

/** Older than this and the fix is read again before it is submitted. */
const STALE_FIX_MS = 90_000

interface Outcome {
  tone: 'success' | 'warning' | 'info'
  title: string
  detail: string
}

interface ResolvedPlace {
  name: string | null
  address: string | null
  label: string | null
  source: 'outlet' | 'google' | 'osm' | 'coordinates' | null
}

async function reverseGeocode(lat: number, lng: number): Promise<ResolvedPlace> {
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
    if (!res.ok) return { name: null, address: null, label: null, source: null }
    return (await res.json()) as ResolvedPlace
  } catch {
    return { name: null, address: null, label: null, source: null }
  }
}

export function ClockPanel({
  day,
  outletCount = 0,
}: {
  day: DayState
  /** How many stores they have altogether, home outlet included. */
  outletCount?: number
}) {
  const router = useRouter()
  // Set once the location is in hand; that is what opens the camera.
  const [pending, setPending] = useState<{
    type: AttendanceType
    fix: Fix
    place: ResolvedPlace
  } | null>(null)
  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const nextType: AttendanceType | null = !day.opening ? 'opening' : !day.closing ? 'closing' : null

  /**
   * Location first, camera second.
   *
   * Taking the selfie before knowing whether there is a usable fix wastes
   * the one thing that is actually awkward to redo, and a fix read after
   * the photo is a fix read from wherever they happened to be standing by
   * then. So the location is settled and named before the camera opens,
   * and the shutter screen says where it thinks they are.
   */
  const start = useCallback(async (type: AttendanceType) => {
    setError(null)
    setOutcome(null)
    try {
      setBusyStep('Getting your location')
      const fix = await requireFix()

      setBusyStep('Naming the place')
      const place = await reverseGeocode(fix.lat, fix.lng)

      setPending({ type, fix, place })
    } catch (err) {
      if (err instanceof GeoBlocked) setError(err.message)
      else setError(err instanceof Error ? err.message : 'Could not read your location.')
    } finally {
      setBusyStep(null)
    }
  }, [])

  const onSelfie = useCallback(
    async (photo: Blob) => {
      const started = pending
      setPending(null)
      if (!started) return
      const type = started.type

      setError(null)
      try {
        // The fix from a moment ago still describes where they are. If the
        // camera was left open, read it again rather than record a place
        // they have since walked away from.
        let fix = started.fix
        let resolved = started.place
        if (Date.now() - Date.parse(fix.captured_at) > STALE_FIX_MS) {
          setBusyStep('Checking your location again')
          fix = await requireFix()
          resolved = await reverseGeocode(fix.lat, fix.lng)
        }
        const where = resolved.label ?? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`

        setBusyStep('Compressing your selfie')
        const { full, thumb } = await processSelfie(photo)

        setBusyStep('Sending')
        const result = await submitOrQueue({
          kind: 'clock',
          type,
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy_m,
          address: resolved.address,
          place_name: resolved.name,
          place_source: resolved.source,
          // Recorded so an auditor can see the image came from the live
          // camera rather than a file chosen on the device.
          device_info: { ...deviceInfo(), selfie_source: 'in_app_camera' },
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
            detail: `No data right now. This ${type === 'opening' ? 'clock-in' : 'clock-out'} is queued from ${where} at ${formatLagos(fix.captured_at, false)}${
              guess ? `, about ${metres(guess)} from your outlet` : ''
            }, and will send itself when you get signal.`,
          })
        } else {
          const record = (
            result.data as {
              attendance: {
                status: string
                distance_m: number | null
                outlet_name: string | null
                outlet_radius_m: number | null
              }
            }
          ).attendance
          // Whichever store the server measured against — for a marketer on
          // a round that is rarely the home outlet.
          const against = record.outlet_name ?? day.outlet?.name ?? 'your outlet'
          // Tell them the truth, including when the truth is inconvenient.
          if (record.status === 'on_site') {
            setOutcome({
              tone: 'success',
              title: type === 'opening' ? 'Clocked in' : 'Clocked out',
              detail: `Location: ${where}. That is ${metres(record.distance_m)} from ${against} — inside the geofence, nothing flagged.`,
            })
          } else if (record.status === 'off_site') {
            setOutcome({
              tone: 'warning',
              title: `${type === 'opening' ? 'Clocked in' : 'Clocked out'} off site`,
              detail: `Location: ${where}. That is ${metres(record.distance_m)} from ${against}, outside the ${record.outlet_radius_m ?? day.outlet?.radius_m ?? 150} m geofence. This is recorded and your admin has been notified.`,
            })
          } else {
            setOutcome({
              tone: 'warning',
              title: 'Recorded, but flagged',
              detail: `Location: ${where}. It could not be verified against an outlet, or the fix was too rough. This is recorded and your admin has been notified.`,
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
    [day.outlet, pending, router],
  )

  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}

      {outcome && (
        <Alert
          variant={outcome.tone === 'success' ? 'success' : outcome.tone === 'warning' ? 'warning' : 'info'}
          className="animate-fade-up"
        >
          <p className="flex items-center gap-1.5 font-bold">
            {outcome.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : outcome.tone === 'info' ? (
              <CloudUpload className="h-4 w-4 text-brand" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
            {outcome.title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{outcome.detail}</p>
        </Alert>
      )}

      {/* The selfie is mandatory and is taken in-app. There is no file
          input in this flow, so a gallery photo cannot be submitted. */}
      <CameraCapture
        open={pending !== null}
        title={pending?.type === 'closing' ? 'Clock out selfie' : 'Clock in selfie'}
        subtitle={pending?.place.label ?? null}
        onCapture={(photo) => void onSelfie(photo)}
        onClose={() => setPending(null)}
      />

      {nextType ? (
        <Button
          size="xl"
          className="w-full"
          disabled={Boolean(busyStep)}
          onClick={() => void start(nextType)}
        >
          {busyStep ? (
            <>
              <Camera className="h-5 w-5 animate-pulse" />
              {busyStep}…
            </>
          ) : (
            <>
              {nextType === 'opening' ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
              {nextType === 'opening' ? 'Clock in with selfie' : 'Clock out with selfie'}
            </>
          )}
        </Button>
      ) : (
        <Alert variant="success" className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <span>Shift complete. One clock-in and one clock-out per day.</span>
        </Alert>
      )}

      {outletCount === 0 && (
        <Alert variant="warning">
          You have no store assigned, so distance cannot be checked and every clock event will be
          flagged. Ask your admin to assign one.
        </Alert>
      )}

      {outletCount > 1 && (
        <p className="text-xs text-muted-foreground">
          You cover {outletCount} stores. You do not have to choose one — Xtend measures against
          whichever you are closest to when you clock.
        </p>
      )}
    </div>
  )
}
