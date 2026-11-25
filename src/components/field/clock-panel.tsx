'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, CheckCircle2, CloudUpload, LogIn, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotificationGate } from '@/components/field/notification-gate'
import { usePush } from '@/components/field/use-push'
import { CameraCapture } from '@/components/field/camera-capture'
import { CLOCK_OUT_EVENT } from '@/components/field/clock-out-prompt'
import { useLocationPermission } from '@/components/field/location-help'
import { LocationGate } from '@/components/field/location-gate'
import { BackgroundGate, useBackgroundNeeds } from '@/components/field/background-gate'
import { Alert } from '@/components/ui/alert'
import { GuideSheet } from '@/components/field/guide-sheet'
import { currentNetwork, isNetworkError, problemFromGeo, problemFromMessage, type GuideProblem } from '@/lib/field-guide'
import { StartStoreSheet, type StartStore } from '@/components/field/start-store-sheet'
import { OffSiteSheet } from '@/components/field/off-site-sheet'
import { offSite as offSiteFrom, offSiteFromServer, type OffSite, type SiteStore } from '@/lib/on-site'
import { processSelfie } from '@/lib/image'
import { deviceInfo } from '@/lib/device'
import { nativeDeviceSignals } from '@/lib/native'
import {
  requireFix,
  probeLocation,
  GeoBlocked,
  haversineMetres,
  positionCheck,
  type Fix,
  type GeoBlockReason,
  type LocationProbe,
  type SampledFix,
} from '@/lib/geo'
import { submitOrQueue, PermanentJobError, noticeStore } from '@/lib/offline/sync'
import { takeClockNotices } from '@/lib/clock-notices'
import { supabase } from '@/lib/supabase/client'
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
  source: 'outlet' | 'known' | 'google' | 'osm' | 'coordinates' | null
}

async function reverseGeocode(lat: number, lng: number): Promise<ResolvedPlace> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: controller.signal })
    if (!res.ok) return { name: null, address: null, label: null, source: null }
    return (await res.json()) as ResolvedPlace
  } catch {
    return { name: null, address: null, label: null, source: null }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Whether location is on enough to clock in or out, for the gate on the home
 * screen. The browser's permission record catches location turned off for
 * Xtend; a coarse probe catches the phone's own location service turned off,
 * which the permission record cannot see. The probe runs only once permission
 * is granted, so it never triggers an early prompt; 'prompt', 'unknown' and
 * Safari fall through to the button, where the tap itself asks for location.
 */
function useClockLocationGate() {
  const permission = useLocationPermission()
  const [probe, setProbe] = useState<LocationProbe | 'checking'>('checking')

  const run = useCallback(async () => {
    setProbe('checking')
    setProbe(await probeLocation())
  }, [])

  useEffect(() => {
    if (permission === 'granted') void run()
    else setProbe('ok')
  }, [permission, run])

  const blocked = permission === 'denied' || probe === 'denied' || probe === 'off'
  const reason: GeoBlockReason | null = !blocked
    ? null
    : permission === 'denied' || probe === 'denied'
      ? 'permission_denied'
      : 'position_unavailable'
  const message =
    reason === 'permission_denied'
      ? 'Xtend records where you clock in and out, so location must be on for Xtend.'
      : 'Your phone’s location (GPS) is off. Turn it on so Xtend can record where you clock in and out.'
  return {
    status: (blocked ? 'blocked' : 'ready') as 'blocked' | 'ready',
    reason,
    message: blocked ? message : null,
    retry: run,
  }
}

/**
 * Reads a clock-in or clock-out back from the database. The server answered
 * that it saved it, but the person is only told so once the row is really
 * there (people read their own rows). True: found. False: the server said
 * saved yet no such row. Null: it could not be checked (no answer, an old
 * server), which is not a reason to doubt the server's own answer.
 */
async function confirmRecorded(id: string | undefined): Promise<boolean | null> {
  if (!id) return null
  try {
    const { data, error } = await supabase().from('attendance').select('id').eq('id', id).maybeSingle()
    if (error) return null
    return Boolean(data)
  } catch {
    return null
  }
}

/** Home's guide asks the clock-in to open the start-of-day store picker. */
export const PICK_START_STORE_EVENT = 'xt-pick-start-store'

export function ClockPanel({
  day,
  notificationsRequired = true,
  startStores = null,
  siteStores = null,
  currentFix = null,
}: {
  day: DayState
  /** False only for someone an admin has excused (profiles.push_exempt). */
  notificationsRequired?: boolean
  /**
   * Marketers (0101): their stores. Clocking in starts with picking the
   * store they are at, and checks them in there. Null for everyone else.
   */
  startStores?: StartStore[] | null
  /** Their own stores (0106): a clock-in from outside them is stopped before the camera. */
  siteStores?: SiteStore[] | null
  currentFix?: { lat: number; lng: number } | null
}) {
  const router = useRouter()
  const push = usePush()
  // Location must be on before clocking in or out: the browser's permission
  // record, plus a coarse probe for the phone's own location service.
  const locationGate = useClockLocationGate()
  // The phone app must be allowed to keep running (location all the time, and
  // on Android no battery saving) before anyone can clock in or out. Nothing
  // is asked in a browser or of an app that does not report these settings.
  const background = useBackgroundNeeds()
  // Set once the location is in hand; that is what opens the camera.
  const [pending, setPending] = useState<{
    type: AttendanceType
    fix: Fix
    place: ResolvedPlace
  } | null>(null)
  // The camera opens as soon as they tap, while the GPS is still working:
  // the two take about the same time, so waiting for one then the other
  // doubled the wait. The shutter stays held until `pending` (the fix) is set.
  const [opening, setOpening] = useState<AttendanceType | null>(null)
  const startRun = useRef(0)
  const placeLookup = useRef<Promise<ResolvedPlace> | null>(null)
  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The step-by-step pop-up when a setting or the location is in the way.
  const [guide, setGuide] = useState<GuideProblem | null>(null)
  const [guideRetry, setGuideRetry] = useState<AttendanceType | null>(null)
  // A marketer's start-of-day store (0101): picked before the camera opens.
  const [picking, setPicking] = useState(false)
  const startStore = useRef<StartStore | null>(null)
  const [startStoreName, setStartStoreName] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // "You are off site" (0106): the store to go to, until they are there.
  const [offSite, setOffSite] = useState<OffSite | null>(null)
  const sites = useRef<SiteStore[] | null>(siteStores)
  sites.current = siteStores
  // Clock-ins and clock-outs made with no signal that the server then
  // refused: told here, since the saved copy has been deleted by then.
  const [notices, setNotices] = useState<string[]>([])
  useEffect(() => {
    const check = () => {
      const fresh = takeClockNotices(noticeStore())
      if (fresh.length) setNotices((current) => [...current, ...fresh.filter((n) => !current.includes(n))])
    }
    check()
    window.addEventListener('online', check)
    const timer = window.setInterval(check, 5000)
    return () => {
      window.removeEventListener('online', check)
      window.clearInterval(timer)
    }
  }, [])
  // Set after a clock-out: the day's login is over.
  const [endsLogin, setEndsLogin] = useState(false)

  const nextType: AttendanceType | null = !day.opening ? 'opening' : !day.closing ? 'closing' : null
  const backgroundHeld = Boolean(!day.closing && background.needs.blocked)
  // Clocking in needs notifications on (migration 027); clocking out never
  // waits on them. 'unconfigured' means the server has no keys: not theirs to fix.
  const needsNotifications =
    nextType === 'opening' &&
    notificationsRequired &&
    (push.state === 'off' || push.state === 'denied' || push.state === 'unsupported' || push.state === 'working')

  /**
   * Location first, camera second.
   *
   * Taking the selfie before knowing whether there is a usable fix wastes
   * the one thing that is actually awkward to redo, and a fix read after
   * the photo is a fix read from wherever they happened to be standing by
   * then. So the location is settled and named before the camera opens,
   * and the shutter screen says where it thinks they are.
   */
  // Read by start(): the "Clock out now" prompt on Home calls it directly, so
  // the held-back button alone would not stop it.
  const heldBack = useRef(false)
  heldBack.current = backgroundHeld

  const start = useCallback(async (type: AttendanceType) => {
    if (heldBack.current) {
      setGuide('phone_settings')
      return
    }
    setError(null)
    setOutcome(null)
    const run = ++startRun.current
    setOpening(type)
    try {
      const fix = await requireFix()
      if (run !== startRun.current) return
      // 0106: not at the store, no clock-in. Said now, before the selfie; a
      // marketer is measured against the store they picked.
      if (type === 'opening' && sites.current) {
        const away = offSiteFrom(fix, sites.current, startStore.current)
        if (away) {
          setOpening(null)
          setOffSite(away)
          return
        }
      }
      // Name the place while they frame the photo; it is not needed to shoot.
      const lookup = reverseGeocode(fix.lat, fix.lng)
      placeLookup.current = lookup
      const none: ResolvedPlace = { name: null, address: null, label: null, source: null }
      setPending({ type, fix, place: none })
      void lookup.then((place) => {
        if (run === startRun.current) setPending((p) => (p && p.fix === fix ? { ...p, place } : p))
      })
    } catch (err) {
      if (run !== startRun.current) return
      setOpening(null)
      if (err instanceof GeoBlocked) {
        setError(err.message)
        // Say what to do, step by step, as well (field-guide).
        setGuide(problemFromGeo(err.reason, currentNetwork()))
        setGuideRetry(type)
      } else {
        setError(err instanceof Error ? err.message : 'Could not read your location.')
        if (isNetworkError(err)) {
          setGuide('no_network')
          setGuideRetry(type)
        }
      }
    }
  }, [])

  // A marketer opening Xtend before clocking in is asked straight away which
  // store they are starting at (0101), once per day on this phone; then the
  // camera opens. Not while a setting or the location is in the way.
  const readyToAsk =
    Boolean(startStores) && nextType === 'opening' && !busyStep && !opening && locationGate.status !== 'blocked'
    && !background.needs.blocked && !needsNotifications
  useEffect(() => {
    if (!readyToAsk) return
    const key = `xt-start-ask-${day.date}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // Private mode: ask anyway.
    }
    setPicking(true)
  }, [readyToAsk, day.date])
  // "Pick a store and clock in" on Your next step opens the picker.
  useEffect(() => {
    if (!startStores) return
    const onAsk = () => setPicking(true)
    window.addEventListener(PICK_START_STORE_EVENT, onAsk)
    return () => window.removeEventListener(PICK_START_STORE_EVENT, onAsk)
  }, [startStores])

  // The "Clock out now" prompt at the top of the home screen starts the
  // clock-out here, the same as tapping the button below.
  useEffect(() => {
    if (nextType !== 'closing' || busyStep || pending || opening) return
    const onAsk = () => void start('closing')
    window.addEventListener(CLOCK_OUT_EVENT, onAsk)
    return () => window.removeEventListener(CLOCK_OUT_EVENT, onAsk)
  }, [nextType, busyStep, pending, opening, start])

  const onSelfie = useCallback(
    async (photo: Blob, at: SampledFix | null) => {
      const started = pending
      setPending(null)
      setOpening(null)
      if (!started) return
      const type = started.type

      setError(null)
      try {
        // The fix from a moment ago still describes where they are. If the
        // camera was left open, read it again rather than record a place
        // they have since walked away from.
        let fix = started.fix
        let resolved = started.place
        // Named while they framed the photo; wait for it only if it is not in yet.
        if (!resolved.label && !resolved.name && placeLookup.current) resolved = await placeLookup.current
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
          // camera rather than a file chosen on the device. The gps block
          // carries the fix's extra fields for the mock-GPS fingerprint
          // check; a real chip fills them in, a fake app usually does not.
          device_info: {
            ...deviceInfo(),
            selfie_source: 'in_app_camera',
            // The store a marketer picked to start at (0101): the clock-in
            // is measured against it and checks them in there.
            ...(type === 'opening' && startStore.current ? { start_store_id: startStore.current.id } : {}),
            // Where the phone was first, and at the shutter: the server
            // checks they agree before asking anyone to add a place.
            position: positionCheck(fix, at),
            gps: {
              altitude: fix.altitude,
              altitude_accuracy: fix.altitude_accuracy,
              speed: fix.speed,
              heading: fix.heading,
            },
            // Present only inside the native shell: Android's mock-location
            // flag and a root / jailbreak check. Empty in a plain browser.
            ...nativeDeviceSignals(
              fix.native_platform
                ? {
                    lat: fix.lat,
                    lng: fix.lng,
                    accuracy_m: fix.accuracy_m,
                    altitude: fix.altitude,
                    speed: fix.speed,
                    heading: fix.heading,
                    is_mock: fix.is_mock ?? false,
                    compromised: fix.compromised ?? false,
                    platform: fix.native_platform as 'android' | 'ios',
                    captured_at: fix.captured_at,
                  }
                : null,
            ),
          },
          client_captured_at: fix.captured_at,
          selfie: full,
          thumb,
        })

        if (result.queued) {
          const guess =
            day.outlet?.lat != null &&
            day.outlet.lng != null &&
            haversineMetres(fix.lat, fix.lng, day.outlet.lat, day.outlet.lng)
          const what = type === 'opening' ? 'clock-in' : 'clock-out'
          setOutcome({
            tone: 'warning',
            title: `Not recorded yet: ${what} saved on your phone`,
            detail: `No signal right now. Your ${what} from ${where} at ${formatLagos(fix.captured_at, false)}${
              guess ? `, about ${metres(guess)} from your outlet` : ''
            } is kept on this phone but is NOT recorded yet. It sends itself when you get signal. Do not count it as done until Home says you are ${type === 'opening' ? 'clocked in' : 'clocked out'}; if it is refused, you will be told. To send it sooner: check Mobile data is on and you have data, then move near the door or a window.`,
          })
        } else {
          const signOut = (result.data as { sign_out?: boolean }).sign_out === true
          const record = (
            result.data as {
              attendance: {
                id?: string
                status: string | null
                accuracy_m: number
                distance_m: number | null
                outlet_name: string | null
                outlet_radius_m: number | null
                store_check_in?: string | null
              }
            }
          ).attendance
          // The server says it saved it. Say so only once it is really there.
          if ((await confirmRecorded(record.id)) === false) {
            setOutcome({
              tone: 'warning',
              title: `${type === 'opening' ? 'Clock-in' : 'Clock-out'} not confirmed`,
              detail: `The server answered, but the record could not be found. Check that Home says you are ${type === 'opening' ? 'clocked in' : 'clocked out'}. If it does not, try again.`,
            })
            router.refresh()
            return
          }
          // Whichever store the server measured against — for a marketer on
          // a round that is rarely the home outlet.
          const against = record.outlet_name ?? day.outlet?.name ?? 'your outlet'
          // Tell them the truth, including when the truth is inconvenient.
          if (record.status === 'on_site') {
            setOutcome({
              tone: 'success',
              title: type === 'opening' ? 'Clocked in' : 'Clocked out',
              detail: `Location: ${where}. That is ${metres(record.distance_m)} from ${against} — inside the store area.`,
            })
          } else if (record.status === 'off_site') {
            setOutcome({
              tone: 'warning',
              title: `${type === 'opening' ? 'Clocked in' : 'Clocked out'} off site`,
              detail: `Location: ${where}. That is ${metres(record.distance_m)} from ${against}, outside the ${record.outlet_radius_m ?? day.outlet?.radius_m ?? 150} m store area.`,
            })
          } else if (record.status === null && record.accuracy_m <= 100) {
            // A good fix with nothing to measure it against: the store is
            // not on the map yet, or there is no store at all.
            setOutcome({
              tone: 'success',
              title: type === 'opening' ? 'Clocked in' : 'Clocked out',
              detail: `Location: ${where}.`,
            })
          } else {
            setOutcome({
              tone: 'warning',
              title: type === 'opening' ? 'Clocked in' : 'Clocked out',
              detail: `Location: ${where}. Your location was not clear enough to match to your store. Next time, wait a moment outside for a better signal.`,
            })
          }

          // Clocked in at one of their stores: checked in there too (0087).
          if (record.store_check_in) {
            setOutcome((o) =>
              o
                ? {
                    ...o,
                    detail: `${o.detail} You are also checked in at ${record.store_check_in}: check out of it before you leave for the next store.`,
                  }
                : o,
            )
          }

          if (signOut) {
            // Their login ends with the day: show the result, then sign out.
            setEndsLogin(true)
            return
          }
        }

        router.refresh()
      } catch (err) {
        if (err instanceof GeoBlocked) {
          setError(err.message)
          setGuide(problemFromGeo(err.reason, currentNetwork()))
          setGuideRetry(type)
        } else if (err instanceof PermanentJobError && offSiteFromServer(err.body)) {
          // 0106: the server says they are not at the store: where to go.
          setOffSite(offSiteFromServer(err.body))
        } else {
          const message = err instanceof Error ? err.message : 'That did not go through. Try again.'
          setError(message)
          // The server's refusal, explained step by step (field-guide).
          const why = problemFromMessage(message)
          if (why) {
            setGuide(why)
            setGuideRetry(type)
          }
        }
      } finally {
        setBusyStep(null)
      }
    },
    [day.outlet, pending, router],
  )

  return (
    <div className="space-y-3">
      {notices.map((n) => (
        <Alert key={n} variant="destructive" className="flex items-start justify-between gap-2">
          <span>{n}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 text-sm font-semibold underline"
            onClick={() => setNotices((current) => current.filter((x) => x !== n))}
          >
            OK
          </button>
        </Alert>
      ))}

      {error && <Alert variant="destructive">{error}</Alert>}
      <GuideSheet
        problem={guide}
        task={(guideRetry ?? nextType) === 'closing' ? 'clock out' : 'clock in'}
        onClose={() => setGuide(null)}
        onRetry={guideRetry ? () => (guideRetry === 'opening' && startStores ? setPicking(true) : void start(guideRetry)) : undefined}
        onPickStore={startStores ? () => setPicking(true) : undefined}
      />
      <OffSiteSheet
        offSite={offSite}
        task="clock in"
        onClose={() => setOffSite(null)}
        onRetry={() => (startStores ? setPicking(true) : void start('opening'))}
      />
      {picking && startStores && (
        <StartStoreSheet
          stores={startStores}
          currentFix={currentFix}
          onClose={() => setPicking(false)}
          onPick={(store) => {
            setPicking(false)
            startStore.current = store
            setStartStoreName(store.name)
            void start('opening')
          }}
        />
      )}

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


      {endsLogin && (
        <Alert variant="info" className="animate-fade-up">
          <p className="font-bold">You are signed out for today</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Clocking out ends your login. Log in again next time you start work. Marketers: log in again any time
            to write your reports for the stores you visited.
          </p>
          <Button
            className="mt-3 w-full"
            onClick={() => {
              window.location.href = '/api/auth/expired?reason=clocked-out'
            }}
          >
            OK
          </Button>
        </Alert>
      )}

      {/* The selfie is mandatory and is taken in-app. There is no file
          input in this flow, so a gallery photo cannot be submitted. */}
      <CameraCapture
        open={opening !== null}
        title={opening === 'closing' ? 'Clock out selfie' : startStoreName ? `Clock in at ${startStoreName}` : 'Clock in selfie'}
        subtitle={pending ? (pending.place.label ?? null) : 'Getting your location…'}
        shutterHeld={pending === null}
        onCapture={(photo, at) => void onSelfie(photo, at)}
        onClose={() => {
          startRun.current++
          setPending(null)
          setOpening(null)
        }}
        locate
      />

      {nextType && locationGate.status === 'blocked' ? (
        <LocationGate
          status="blocked"
          reason={locationGate.reason}
          message={locationGate.message}
          onRetry={() => void locationGate.retry()}
        >
          {null}
        </LocationGate>
      ) : nextType && background.needs.blocked ? (
        <BackgroundGate
          state={background.state}
          needs={background.needs}
          action={nextType === 'opening' ? 'clock in' : 'clock out'}
          onDone={() => void background.recheck()}
          onConfirmBattery={background.confirmBattery}
          onConfirmMaker={background.confirmMaker}
        />
      ) : needsNotifications ? (
        <NotificationGate push={push} />
      ) : nextType ? (
        <button
          id="clock-button"
          type="button"
          disabled={Boolean(busyStep)}
          onClick={() => (nextType === 'opening' && startStores ? setPicking(true) : void start(nextType))}
          className="relative flex h-16 w-full items-center rounded-full bg-brand p-2 text-primary-foreground transition-[filter] hover:brightness-105 active:scale-[0.99] disabled:opacity-80"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand">
            {busyStep ? (
              <Camera className="h-5 w-5 animate-pulse" />
            ) : nextType === 'opening' ? (
              <LogIn className="h-5 w-5" />
            ) : (
              <LogOut className="h-5 w-5" />
            )}
          </span>
          <span className="flex-1 text-center text-base font-semibold italic">
            {busyStep
              ? `${busyStep}…`
              : nextType === 'opening'
                ? 'Clock in with selfie'
                : 'Clock out with selfie'}
          </span>
          <span aria-hidden className="w-12 shrink-0 text-center text-lg tracking-[-0.2em] text-white/70">
            ›››
          </span>
        </button>
      ) : (
        <Alert variant="success" className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <span>Shift complete. One clock-in and one clock-out per day.</span>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        You do not have to choose a store.
      </p>
    </div>
  )
}
