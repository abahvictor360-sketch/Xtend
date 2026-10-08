'use client'

import { getNativeFix } from '@/lib/native'

/** A fix worse than this is not evidence of anything. */
export const ACCURACY_CEILING_M = 100
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
export const HEARTBEAT_GEOFENCE_M = 300

export type GeoBlockReason = 'permission_denied' | 'position_unavailable' | 'low_accuracy' | 'unsupported'

export interface Fix {
  lat: number
  lng: number
  accuracy_m: number
  captured_at: string
  // The extra GNSS fields. A real chip fills these in outdoors; a
  // fake-location app usually leaves them null. Carried to the server as
  // part of a mock-GPS fingerprint, never used for distance.
  altitude: number | null
  altitude_accuracy: number | null
  speed: number | null
  heading: number | null
  // Set only inside the native shell. is_mock is Android's hard
  // mock-location flag; compromised is root (Android) or jailbreak (iOS).
  is_mock?: boolean | null
  compromised?: boolean | null
  native_platform?: string | null
}

export class GeoBlocked extends Error {
  constructor(
    readonly reason: GeoBlockReason,
    message: string,
    readonly accuracy_m?: number,
  ) {
    super(message)
  }
}

export function readPosition(timeoutMs = 20000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoBlocked('unsupported', 'This browser cannot report your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        reject(
          new GeoBlocked(
            'permission_denied',
            'Location permission is off. Xtend cannot record attendance without it.',
          ),
        )
      } else {
        reject(
          new GeoBlocked(
            'position_unavailable',
            'Your phone could not get a location fix. Step outside or near a window and retry.',
          ),
        )
      }
    }, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 })
  })
}

export interface FixOptions {
  /** Stop as soon as a reading is at least this good, in metres. */
  targetAccuracyM?: number
  /** Keep listening this long for a better reading, once there is one. */
  settleMs?: number
  /** At least this many readings before stopping early. */
  minSamples?: number
  /** Give up if no reading at all arrives in this time. */
  timeoutMs?: number
}

/** A fix built from several readings, with how much they agreed. */
export interface SampledFix extends Fix {
  /** Readings taken, and how many were good enough to use. */
  samples: number
  used: number
  /** How far the readings used lay from the result, at most. */
  spread_m: number
}

const DEFAULTS: Required<FixOptions> = { targetAccuracyM: 20, settleMs: 8000, minSamples: 1, timeoutMs: 20000 }

function fromPosition(pos: GeolocationPosition): Fix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy,
    captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
    altitude: pos.coords.altitude,
    altitude_accuracy: pos.coords.altitudeAccuracy,
    speed: pos.coords.speed,
    heading: pos.coords.heading,
  }
}

/**
 * One position from many readings. A phone's first reading is often its
 * worst (a cell tower or Wi-Fi guess before the GPS chip has locked on),
 * so this keeps listening, takes the best readings, and averages them,
 * weighting each by how sure the phone was of it. Readings more than twice
 * as uncertain as the best are left out. Pure: exported for tests.
 */
export function combineFixes(readings: Fix[]): SampledFix | null {
  const good = readings.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && Number.isFinite(r.accuracy_m))
  if (!good.length) return null
  const best = good.reduce((a, b) => (b.accuracy_m < a.accuracy_m ? b : a))
  // Readings up to twice as uncertain as the best still help the average;
  // a rough first guess (a cell tower, often 100 m+) does not.
  const limit = Math.max(best.accuracy_m * 2, best.accuracy_m + 10)
  const used = good.filter((r) => r.accuracy_m <= limit)
  if (used.length === 1) return { ...best, samples: good.length, used: 1, spread_m: 0 }
  let wSum = 0
  let lat = 0
  let lng = 0
  for (const r of used) {
    const w = 1 / Math.max(r.accuracy_m, 1) ** 2
    wSum += w
    lat += r.lat * w
    lng += r.lng * w
  }
  lat /= wSum
  lng /= wSum
  const spread = Math.max(...used.map((r) => haversineMetres(lat, lng, r.lat, r.lng)))
  const latest = used.reduce((a, b) => (b.captured_at > a.captured_at ? b : a))
  return {
    ...latest,
    lat,
    lng,
    // Never claim better than the best single reading, nor than how far the
    // readings scattered.
    accuracy_m: Math.max(best.accuracy_m, spread),
    samples: good.length,
    used: used.length,
    spread_m: spread,
  }
}

/** Whether two fixes plausibly describe the same spot. */
export function fixesAgree(a: Pick<Fix, 'lat' | 'lng' | 'accuracy_m'>, b: Pick<Fix, 'lat' | 'lng' | 'accuracy_m'>) {
  const apart = haversineMetres(a.lat, a.lng, b.lat, b.lng)
  return { apart, agree: apart <= Math.max(30, a.accuracy_m + b.accuracy_m) }
}

function browserReadings(o: Required<FixOptions>): Promise<Fix[]> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoBlocked('unsupported', 'This browser cannot report your location.'))
      return
    }
    const started = Date.now()
    const readings: Fix[] = []
    let firstAt = 0
    let done = false
    const finish = () => {
      if (done) return
      done = true
      navigator.geolocation.clearWatch(watch)
      clearInterval(timer)
      resolve(readings)
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        // A cached position from before we asked is not where they are now.
        if (pos.timestamp && pos.timestamp < started - 2000) return
        readings.push(fromPosition(pos))
        if (!firstAt) firstAt = Date.now()
        const best = Math.min(...readings.map((r) => r.accuracy_m))
        if (readings.length >= o.minSamples && best <= o.targetAccuracyM) finish()
      },
      (err) => {
        if (readings.length) return finish()
        done = true
        navigator.geolocation.clearWatch(watch)
        clearInterval(timer)
        reject(
          err.code === err.PERMISSION_DENIED
            ? new GeoBlocked('permission_denied', 'Location permission is off. Xtend cannot record attendance without it.')
            : new GeoBlocked('position_unavailable', 'Your phone could not get a location fix. Step outside or near a window and retry.'),
        )
      },
      { enableHighAccuracy: true, timeout: o.timeoutMs, maximumAge: 0 },
    )
    const timer = setInterval(() => {
      const now = Date.now()
      if (firstAt && now - firstAt >= o.settleMs) finish()
      else if (!firstAt && now - started >= o.timeoutMs) {
        done = true
        navigator.geolocation.clearWatch(watch)
        clearInterval(timer)
        reject(new GeoBlocked('position_unavailable', 'Your phone could not get a location fix. Step outside or near a window and retry.'))
      }
    }, 250)
  })
}

async function nativeReadings(o: Required<FixOptions>): Promise<Fix[] | null> {
  const started = Date.now()
  const readings: Fix[] = []
  while (readings.length < 6) {
    const n = await getNativeFix()
    if (!n) break
    readings.push({
      lat: n.lat,
      lng: n.lng,
      accuracy_m: n.accuracy_m,
      captured_at: n.captured_at || new Date().toISOString(),
      altitude: n.altitude,
      altitude_accuracy: null,
      speed: n.speed,
      heading: n.heading,
      is_mock: n.is_mock,
      compromised: n.compromised,
      native_platform: n.platform,
    })
    const best = Math.min(...readings.map((r) => r.accuracy_m))
    if (readings.length >= o.minSamples && best <= o.targetAccuracyM) break
    if (Date.now() - started >= o.settleMs) break
  }
  return readings.length ? readings : null
}

/**
 * The best fix the phone can give within a few seconds: several readings,
 * combined. Stops early when a reading is already good, so a good signal
 * is as quick as a single reading. Throws GeoBlocked when nothing within
 * the accuracy ceiling arrives.
 */
export async function bestFix(options: FixOptions = {}): Promise<SampledFix> {
  const o = { ...DEFAULTS, ...options }
  // Inside the native shell, take readings from the OS so we also get the
  // mock-location flag the browser cannot see. Falls through to the browser
  // in a plain PWA, or if the native call returns nothing.
  const readings = (await nativeReadings(o)) ?? (await browserReadings(o))
  const fix = combineFixes(readings)
  if (!fix) {
    throw new GeoBlocked('position_unavailable', 'Your phone could not get a location fix. Step outside or near a window and retry.')
  }
  // A mock flag on any reading stays on the result.
  if (readings.some((r) => r.is_mock)) fix.is_mock = true
  if (readings.some((r) => r.compromised)) fix.compromised = true
  if (fix.accuracy_m > ACCURACY_CEILING_M) {
    throw new GeoBlocked(
      'low_accuracy',
      `Your location is only accurate to ${Math.round(fix.accuracy_m)} m. Xtend needs ${ACCURACY_CEILING_M} m or better.`,
      fix.accuracy_m,
    )
  }
  return fix
}

/** Throws GeoBlocked unless we hold a live fix inside the accuracy ceiling. */
export async function requireFix(timeoutMs?: number): Promise<SampledFix> {
  return bestFix(timeoutMs ? { timeoutMs } : {})
}

/**
 * Follows the position while the camera is open, so a photo carries where
 * it was taken: the reading nearest the shutter, never one from before the
 * camera opened. Null when no reading came in time.
 */
export function followPosition() {
  const readings: Fix[] = []
  let watch: number | null = null
  const started = Date.now()
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.timestamp && pos.timestamp < started - 2000) return
        readings.push(fromPosition(pos))
        if (readings.length > 20) readings.shift()
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    )
  }
  return {
    /** The position at the shutter: the recent readings, combined. */
    async atShutter(waitMs = 4000): Promise<SampledFix | null> {
      const shutter = Date.now()
      const recent = () => readings.filter((r) => shutter - Date.parse(r.captured_at) <= 10000)
      if (!recent().length) {
        // Native shell, or nothing in yet: ask once more, briefly.
        const native = await nativeReadings({ ...DEFAULTS, minSamples: 1, settleMs: 0 })
        if (native) return combineFixes(native)
        const deadline = Date.now() + waitMs
        while (!recent().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
      }
      return combineFixes(recent())
    },
    stop() {
      if (watch !== null && typeof navigator !== 'undefined') navigator.geolocation.clearWatch(watch)
      watch = null
    },
  }
}

/**
 * The first fix and the one taken at the camera's shutter, side by side,
 * for the server (device_info.position). The server only asks someone to
 * add a place when the two agree (migration 045): a fix that jumped is not
 * a place to save.
 */
export function positionCheck(first: Fix | SampledFix, shutter: SampledFix | null) {
  const brief = (f: Fix | SampledFix) => ({
    lat: f.lat,
    lng: f.lng,
    accuracy_m: Math.round(f.accuracy_m * 10) / 10,
    captured_at: f.captured_at,
    ...('samples' in f ? { samples: f.samples, spread_m: Math.round(f.spread_m * 10) / 10 } : {}),
  })
  const check = shutter ? fixesAgree(first, shutter) : null
  return {
    first: brief(first),
    shutter: shutter ? brief(shutter) : null,
    apart_m: check ? Math.round(check.apart) : null,
    agree: check ? check.agree : null,
  }
}

/** Display only. The authoritative distance is computed by the database. */
export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
