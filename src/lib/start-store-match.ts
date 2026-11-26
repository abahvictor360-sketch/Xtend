import { haversineMetres } from '@/lib/geo'
import { tooFar } from '@/lib/on-site'

/**
 * A marketer clocking in (2026-11-26): the store they are standing in,
 * matched from their own stores by where the phone is. The nearest store
 * whose area (radius, plus up to 50 m of the phone's accuracy, the same
 * rule as "on site") holds them; null when none does, and then they pick.
 * Stores still waiting for their location cannot be matched. Pure, so
 * scripts/check-start-store.ts can test it.
 */
export function matchStartStore<
  S extends { id: string; lat: number | null; lng: number | null; geofence_radius_m: number | null },
>(fix: { lat: number; lng: number; accuracy_m: number | null }, stores: S[]): S | null {
  let best: { store: S; d: number } | null = null
  for (const s of stores) {
    if (s.lat === null || s.lng === null) continue
    const d = haversineMetres(fix.lat, fix.lng, s.lat, s.lng)
    if (tooFar(d, s.geofence_radius_m ?? 150, fix.accuracy_m)) continue
    if (!best || d < best.d) best = { store: s, d }
  }
  return best?.store ?? null
}

/** The nearest pinned store, for asking Google when nothing matched (0114). */
export function nearestStore<S extends { lat: number | null; lng: number | null }>(
  fix: { lat: number; lng: number },
  stores: S[],
): S | null {
  let best: { store: S; d: number } | null = null
  for (const s of stores) {
    if (s.lat === null || s.lng === null) continue
    const d = haversineMetres(fix.lat, fix.lng, s.lat, s.lng)
    if (!best || d < best.d) best = { store: s, d }
  }
  return best?.store ?? null
}
