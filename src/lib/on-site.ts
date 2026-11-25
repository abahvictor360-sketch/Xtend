/**
 * On site only (0106): nobody clocks in or checks in at a store from
 * outside it. The phone checks before the camera opens, so nobody takes a
 * selfie for nothing; the database refuses it anyway (it has the last
 * word). Pure, so scripts/check-on-site.ts can test it, and the same rule
 * as public.too_far() in the database.
 */

import { haversineMetres } from '@/lib/geo'

/** The most of a phone's stated accuracy given the benefit of the doubt. */
export const ACCURACY_ALLOWANCE_M = 50

export interface SiteStore {
  id: string
  name: string
  address?: string | null
  lat: number | null
  lng: number | null
  geofence_radius_m: number | null
}

export interface OffSite {
  store: { id: string; name: string; address: string | null; lat: number; lng: number }
  distance_m: number
  radius_m: number
}

/**
 * Outside the store's area, allowing for the phone's accuracy up to 50 m:
 * someone 170 m from a 150 m store with a 30 m fix may be inside.
 */
export function tooFar(distance: number | null, radius: number | null, accuracy: number | null): boolean {
  if (distance === null || !Number.isFinite(distance)) return false
  const allowance = Math.min(Math.max(accuracy ?? 0, 0), ACCURACY_ALLOWANCE_M)
  return distance > (radius ?? 150) + allowance
}

/**
 * Where the person must go. `target` is the store they named (a marketer's
 * start store, or a store picked by hand); without one, the nearest of their
 * stores. Null when they are close enough, or when there is nothing to
 * measure against (no stores, or a store still waiting for its location).
 */
export function offSite(
  fix: { lat: number; lng: number; accuracy_m: number | null },
  stores: SiteStore[],
  target: SiteStore | null = null,
): OffSite | null {
  const measure = (s: SiteStore) =>
    s.lat === null || s.lng === null ? null : haversineMetres(fix.lat, fix.lng, s.lat, s.lng)
  let store = target
  if (!store) {
    // A store with no location yet may be the one they are in: no verdict.
    if (!stores.length || stores.some((s) => s.lat === null || s.lng === null)) return null
    store = [...stores].sort((a, b) => (measure(a) ?? Infinity) - (measure(b) ?? Infinity))[0]
  }
  const distance = measure(store)
  if (distance === null || store.lat === null || store.lng === null) return null
  const radius = store.geofence_radius_m ?? 150
  if (!tooFar(distance, radius, fix.accuracy_m)) return null
  return {
    store: { id: store.id, name: store.name, address: store.address ?? null, lat: store.lat, lng: store.lng },
    distance_m: Math.round(distance),
    radius_m: radius,
  }
}

/** "420 m" or "1.3 km". */
export function distanceWords(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

/** Google Maps directions to the store, from where they are. */
export function directionsTo(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

/** What they are told; the database says the same (0106). */
export function offSiteWords(o: OffSite, task: string): string {
  return `You are off site: ${distanceWords(o.distance_m)} from ${o.store.name}. Go to ${o.store.name}${
    o.store.address ? ` (${o.store.address})` : ''
  }, then ${task} there.`
}

/** Reads the store out of the server's refusal (0106), if it sent one. */
export function offSiteFromServer(body: unknown): OffSite | null {
  const b = body as { code?: string; off_site?: Partial<OffSite> & { store?: Partial<OffSite['store']> } } | null
  const o = b?.code === 'off_site' ? b.off_site : null
  const s = o?.store
  if (!o || !s || typeof s.name !== 'string' || typeof s.lat !== 'number' || typeof s.lng !== 'number') return null
  return {
    store: { id: String(s.id ?? ''), name: s.name, address: typeof s.address === 'string' ? s.address : null, lat: s.lat, lng: s.lng },
    distance_m: Number(o.distance_m ?? 0),
    radius_m: Number(o.radius_m ?? 150),
  }
}
