/**
 * Follow live (migration 0070): the pure parts, shared by the follow page,
 * the web heartbeat and the check script (scripts/check-follow-live.ts).
 *
 * The phone sends a position every FAST_INTERVAL_MS while someone follows
 * it; the page moves the photo pin smoothly from where it is drawn to the
 * new position over about one interval, so it glides like a delivery
 * rider instead of jumping.
 */

/** What the database answers while someone follows (follow_fast_interval_ms). */
export const FAST_INTERVAL_MS = 8000
/** A session lasts this long; "Keep following" adds the same again. */
export const FOLLOW_MINUTES = 30
/** The follow page checks in this often… */
export const FOLLOW_HEARTBEAT_MS = 20_000
/** …and the session ends once it has not for this long. */
export const FOLLOW_GRACE_MS = 60_000
/** "Keep following" is offered in the last minutes. */
export const OFFER_EXTEND_MS = 5 * 60_000
/** The breadcrumb trail on the map. */
export const TRAIL_MINUTES = 5
/** Slower than this is standing still (GPS drifts a little). */
export const MOVING_KMH = 2
/** The native tracker treats a fast instruction as gone after this without a fresh answer. */
export const FAST_HOLD_MS = 60_000

export interface LivePoint {
  lat: number
  lng: number
  /** When the phone took it (ms since epoch). */
  at: number
  accuracy_m?: number | null
  /** Degrees from north, as the phone reported (null when unknown). */
  heading?: number | null
  /** Metres per second, as the phone reported (null when unknown). */
  speed_mps?: number | null
}

const R = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Compass bearing from a to b, 0–360 (0 = north, 90 = east). */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Where the pin is drawn a fraction t (0–1) of the way from a to b. */
export function interpolate(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 1))
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k }
}

/**
 * How long the glide to a new position takes: about one interval (the next
 * position arrives as the pin gets there), never more than 1.5 intervals
 * (a late one should not crawl) and no glide at all for a jump of over
 * 2 km (a GPS fix after a long silence teleports rather than slides).
 */
export function glideMs(from: { lat: number; lng: number } | null, to: { lat: number; lng: number }, intervalMs = FAST_INTERVAL_MS) {
  if (!from) return 0
  if (distanceM(from, to) > 2000) return 0
  return Math.round(Math.min(Math.max(intervalMs, 1000), FAST_INTERVAL_MS * 1.5))
}

/** Progress (0–1) of a glide that started at `startedAt` and lasts `ms`. */
export function glideProgress(startedAt: number, ms: number, now: number) {
  if (ms <= 0) return 1
  return Math.max(0, Math.min(1, (now - startedAt) / ms))
}

/**
 * Speed in km/h: what the phone reported when it did, else from the last
 * two positions. Null when unknown (one position, or the same moment).
 */
export function speedKmh(prev: LivePoint | null, next: LivePoint): number | null {
  if (next.speed_mps != null && Number.isFinite(next.speed_mps) && next.speed_mps >= 0) {
    return next.speed_mps * 3.6
  }
  if (!prev) return null
  const s = (next.at - prev.at) / 1000
  if (s <= 0) return null
  return (distanceM(prev, next) / s) * 3.6
}

export const isMoving = (kmh: number | null) => kmh != null && kmh >= MOVING_KMH

/**
 * The way the arrow points: the phone's own heading while moving, else the
 * direction between the last two positions when they are far enough apart
 * to mean something (more than 5 m and more than their accuracy), else none.
 */
export function headingFor(prev: LivePoint | null, next: LivePoint, kmh: number | null): number | null {
  if (!isMoving(kmh)) return null
  if (next.heading != null && Number.isFinite(next.heading) && next.heading >= 0 && next.heading <= 360) {
    return next.heading % 360
  }
  if (!prev) return null
  const d = distanceM(prev, next)
  if (d < Math.max(5, next.accuracy_m ?? 0)) return null
  return bearing(prev, next)
}

/** The last few minutes of positions, oldest first. */
export function trimTrail<T extends { at: number }>(points: T[], now: number, minutes = TRAIL_MINUTES): T[] {
  const from = now - minutes * 60_000
  return points.filter((p) => p.at >= from).sort((a, b) => a.at - b.at)
}

/** "Updated 5 s ago", "Updated 2 min ago". */
export function updatedAgo(at: number | null, now: number): string {
  if (at == null) return 'Waiting for their position…'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `Updated ${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `Updated ${m} min ago`
  return `Updated ${Math.floor(m / 60)} h ${m % 60} min ago`
}

/** Whole minutes and seconds left, e.g. "28:05". */
export function timeLeft(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.round((expiresAt - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type FollowEnd = 'stopped' | 'closed' | 'expired' | 'clocked_out'

export interface FollowTiming {
  /** Still following. */
  live: boolean
  /** Show "Keep following". */
  offerExtend: boolean
  /** Why it ended, when it has. */
  ended: FollowEnd | null
}

/**
 * The page's view of the session from the server's answer and the clock.
 * The server decides; this only fills the gap between check-ins (a timer
 * that ran out on the page counts as run out before the server says so).
 */
export function followTiming(
  s: { active: boolean; end_reason: FollowEnd | null; expires_at: number; clocked_out: boolean },
  now: number,
): FollowTiming {
  if (s.clocked_out) return { live: false, offerExtend: false, ended: 'clocked_out' }
  if (s.end_reason && s.end_reason !== 'expired') return { live: false, offerExtend: false, ended: s.end_reason }
  if (!s.active || s.end_reason === 'expired' || s.expires_at <= now) {
    return { live: false, offerExtend: true, ended: 'expired' }
  }
  return { live: true, offerExtend: s.expires_at - now <= OFFER_EXTEND_MS, ended: null }
}

/**
 * The interval a phone sends at: the server's `interval_ms` when it gave a
 * sensible one (2–60 s), else the normal one. Used by the web heartbeat;
 * the native trackers apply the same rule.
 */
export function nextInterval(reply: { interval_ms?: unknown } | null | undefined, normalMs: number): number {
  const v = reply?.interval_ms
  if (typeof v === 'number' && Number.isFinite(v) && v >= 2000 && v <= 60_000) return Math.round(v)
  return normalMs
}

/** Fast mode holds until `until`; an answer with an interval renews it. */
export function fastHoldUntil(reply: { interval_ms?: unknown } | null | undefined, now: number, normalMs: number) {
  return nextInterval(reply, normalMs) !== normalMs ? now + FAST_HOLD_MS : 0
}

/** The words for an ended session. */
export function endedText(ended: FollowEnd, clockedOutAt: string | null): string {
  switch (ended) {
    case 'clocked_out':
      return clockedOutAt ? `Clocked out at ${clockedOutAt}. Following has stopped.` : 'They have clocked out. Following has stopped.'
    case 'expired':
      return 'Following stopped after 30 minutes.'
    case 'closed':
      return 'Following stopped because this page was away for a while.'
    default:
      return 'You stopped following.'
  }
}
