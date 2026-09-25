/**
 * One person's day, from movement_trail() (migration 028), turned into the
 * figures a supervisor asks about: how far they moved, how long they were
 * away from their store, and the longest stretch Xtend heard nothing.
 * Plain functions, used on the server and in the browser alike.
 */

export type PointKind = 'clock_in' | 'clock_out' | 'location' | 'visit_in' | 'visit_out' | 'app'

export interface TrailPoint {
  at: string
  kind: PointKind
  lat: number
  lng: number
  accuracy_m: number | null
  distance_m: number | null
  place: string | null
  outlet_id: string | null
}

export interface TrailStore {
  id: string
  name: string
  lat: number
  lng: number
  radius_m: number
}

export interface Trail {
  person: { id: string; name: string; phone: string | null; role: string } | null
  date: string
  points: TrailPoint[]
  stores: TrailStore[]
}

/** A reading rougher than this is shown, but not used to measure anything. */
export const ROUGH_M = 100
/** Longer than this without a position is a gap worth pointing out. */
export const GAP_MINUTES = 20

export const KIND_LABEL: Record<PointKind, string> = {
  clock_in: 'Clocked in',
  clock_out: 'Clocked out',
  location: 'Location check',
  visit_in: 'Checked in at a store',
  visit_out: 'Checked out of a store',
  app: 'Phone reported in',
}

export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/** The store a point is inside, if any. */
export function storeAt(point: { lat: number; lng: number }, stores: TrailStore[]) {
  return stores.find((s) => metresBetween(point.lat, point.lng, s.lat, s.lng) <= s.radius_m) ?? null
}

export interface TrailSummary {
  firstAt: string | null
  lastAt: string | null
  clockedIn: string | null
  clockedOut: string | null
  distanceM: number
  outsideMinutes: number
  longestGap: { from: string; to: string; minutes: number } | null
  gaps: { from: string; to: string; minutes: number }[]
  positions: number
}

const minutesBetween = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 60000

export function summarise(trail: Trail): TrailSummary {
  const points = trail.points
  const good = points.filter((p) => (p.accuracy_m ?? 0) <= ROUGH_M)

  // Distance: straight lines between good readings, ignoring jitter under
  // the readings' own accuracy so a person standing still does not "walk".
  let distanceM = 0
  for (let i = 1; i < good.length; i++) {
    const a = good[i - 1]
    const b = good[i]
    const d = metresBetween(a.lat, a.lng, b.lat, b.lng)
    const noise = Math.max(a.accuracy_m ?? 0, b.accuracy_m ?? 0, 20)
    if (d > noise) distanceM += d
  }

  // Time away: each stretch between two readings counts as outside when
  // the reading that starts it is outside every store they have.
  let outsideMinutes = 0
  for (let i = 1; i < good.length; i++) {
    if (!storeAt(good[i - 1], trail.stores)) {
      outsideMinutes += Math.min(minutesBetween(good[i - 1].at, good[i].at), 60)
    }
  }

  const gaps: TrailSummary['gaps'] = []
  for (let i = 1; i < points.length; i++) {
    const minutes = minutesBetween(points[i - 1].at, points[i].at)
    if (minutes >= GAP_MINUTES && points[i - 1].kind !== 'clock_out') {
      gaps.push({ from: points[i - 1].at, to: points[i].at, minutes: Math.round(minutes) })
    }
  }

  return {
    firstAt: points[0]?.at ?? null,
    lastAt: points[points.length - 1]?.at ?? null,
    clockedIn: points.find((p) => p.kind === 'clock_in')?.at ?? null,
    clockedOut: points.find((p) => p.kind === 'clock_out')?.at ?? null,
    distanceM,
    outsideMinutes: Math.round(outsideMinutes),
    longestGap: gaps.reduce<TrailSummary['longestGap']>(
      (m, g) => (!m || g.minutes > m.minutes ? g : m),
      null,
    ),
    gaps,
    positions: points.length,
  }
}

export function duration(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}
