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

/** Throws GeoBlocked unless we hold a live fix inside the accuracy ceiling. */
export async function requireFix(timeoutMs?: number): Promise<Fix> {
  // Inside the native shell, take the fix from the OS so we also get the
  // mock-location flag the browser cannot see. Falls through to the browser
  // Geolocation API in a plain PWA, or if the native call returns nothing.
  const native = await getNativeFix()
  if (native) {
    if (!Number.isFinite(native.accuracy_m) || native.accuracy_m > ACCURACY_CEILING_M) {
      throw new GeoBlocked(
        'low_accuracy',
        `Your location is only accurate to ${Math.round(native.accuracy_m)} m. Xtend needs ${ACCURACY_CEILING_M} m or better.`,
        native.accuracy_m,
      )
    }
    return {
      lat: native.lat,
      lng: native.lng,
      accuracy_m: native.accuracy_m,
      captured_at: native.captured_at || new Date().toISOString(),
      altitude: native.altitude,
      altitude_accuracy: null,
      speed: native.speed,
      heading: native.heading,
      is_mock: native.is_mock,
      compromised: native.compromised,
      native_platform: native.platform,
    }
  }

  const pos = await readPosition(timeoutMs)
  const accuracy = pos.coords.accuracy

  if (!Number.isFinite(accuracy) || accuracy > ACCURACY_CEILING_M) {
    throw new GeoBlocked(
      'low_accuracy',
      `Your location is only accurate to ${Math.round(accuracy)} m. Xtend needs ${ACCURACY_CEILING_M} m or better.`,
      accuracy,
    )
  }

  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy_m: accuracy,
    captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
    altitude: pos.coords.altitude,
    altitude_accuracy: pos.coords.altitudeAccuracy,
    speed: pos.coords.speed,
    heading: pos.coords.heading,
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
