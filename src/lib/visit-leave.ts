/**
 * "Check out before you leave" (2026-11-26): the phone's tracker is told
 * which store visit is open, with where it is and how big its area is, and
 * rings an alarm when the person steps outside it without checking out.
 * Pure, so scripts/check-visit-leave.ts can test it; the phones use the
 * same rule (ShiftTrackerService.java, ShiftTracker.swift).
 */

export interface OpenVisitRow {
  id: string
  outlet_lat: number | null
  outlet_lng: number | null
  outlet_radius_m: number | null
  arrived_lat: number | null
  arrived_lng: number | null
  arrived_place_name: string | null
  outlets: { name: string } | { name: string }[] | null
}

/** A visit at a place that is not a store is watched around where they checked in. */
export const PLACE_RADIUS_M = 150

export function openVisitForPhone(
  row: OpenVisitRow | null,
): { id: string; name: string; lat: number; lng: number; radius_m: number } | null {
  if (!row) return null
  const outlet = Array.isArray(row.outlets) ? row.outlets[0] : row.outlets
  const atStore = row.outlet_lat != null && row.outlet_lng != null
  const lat = atStore ? row.outlet_lat : row.arrived_lat
  const lng = atStore ? row.outlet_lng : row.arrived_lng
  if (lat == null || lng == null) return null
  return {
    id: row.id,
    name: outlet?.name ?? row.arrived_place_name ?? 'the store',
    lat,
    lng,
    radius_m: atStore ? (row.outlet_radius_m ?? PLACE_RADIUS_M) : PLACE_RADIUS_M,
  }
}

/**
 * Outside the store's area: further than its radius plus the phone's
 * accuracy (up to 50 m), so a rough reading inside does not ring. A reading
 * rougher than 100 m says nothing either way.
 */
export function leftTheStore(distanceM: number, radiusM: number, accuracyM: number): boolean | null {
  if (!(accuracyM >= 0) || accuracyM > 100) return null
  return distanceM > radiusM + Math.min(accuracyM, 50)
}

/** The alarm on the phone (Android and iPhone use these words). */
export const LEAVE_ALARM = {
  title: 'Check out before you leave',
  /** Followed by the store's name, then LEAVE_ALARM.end. */
  start: 'You are leaving ',
  end: ' without checking out. Go back and check out there.',
} as const

export function leaveAlarmBody(store: string) {
  return `${LEAVE_ALARM.start}${store}${LEAVE_ALARM.end}`
}
