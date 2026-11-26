import { haversineMetres } from '@/lib/geo'

/**
 * Checking a store with Google before saying "off site" (migration 0114).
 * Pure, so scripts/check-store-google.ts can exercise it.
 *
 * Google is asked twice: Places for the store's name with its address (it
 * pins the shop), and Geocoding for the address alone. The answer counts
 * only when the two agree, so a branch of the same chain on another street
 * never passes for this one. A store with no address is never confirmed.
 */

export interface GooglePoint {
  lat: number
  lng: number
}

export interface GoogleStoreAnswer {
  places: (GooglePoint & { name: string | null; address: string | null }) | null
  geocode: (GooglePoint & { type: string | null; address: string | null }) | null
}

/** How far apart Places and Geocoding may be and still agree. */
export const AGREE_WITHIN_M = 300

/** Where the store is, when Google is sure; null when it is not. */
export function googleAgrees(answer: GoogleStoreAnswer, address: string | null | undefined): GooglePoint | null {
  if (!address?.trim()) return null
  const { places, geocode } = answer
  if (places && geocode) {
    return haversineMetres(places.lat, places.lng, geocode.lat, geocode.lng) <= AGREE_WITHIN_M
      ? { lat: places.lat, lng: places.lng }
      : null
  }
  // No shop found, but the address pinned to the building itself.
  if (!places && geocode?.type === 'ROOFTOP') return { lat: geocode.lat, lng: geocode.lng }
  return null
}

/** Looked up again after this long, or when the name or address changes. */
export const RECHECK_DAYS = 90
/** An answer that did not confirm the store is asked again after a week. */
export const RETRY_UNCONFIRMED_DAYS = 7

export function needsLookup(
  saved: { name_used: string; address_used: string; confirmed: boolean; looked_up_at: string } | null,
  store: { name: string; address: string | null },
  now = Date.now(),
): boolean {
  if (!saved) return true
  if (saved.name_used !== store.name || saved.address_used !== (store.address ?? '').trim()) return true
  const age = now - Date.parse(saved.looked_up_at)
  return age > (saved.confirmed ? RECHECK_DAYS : RETRY_UNCONFIRMED_DAYS) * 86_400_000
}
