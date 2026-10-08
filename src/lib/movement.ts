/**
 * One person's day, from movement_trail() (migration 028), turned into the
 * figures a supervisor asks about: how far they moved, how long they were
 * away from their store, and the longest stretch Xtend heard nothing.
 * Plain functions, used on the server and in the browser alike.
 */

export type PointKind =
  | 'clock_in'
  | 'clock_out'
  | 'location'
  | 'location_offline'
  | 'visit_in'
  | 'visit_out'
  | 'app'

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
  location_offline: 'Location check (no network, sent later)',
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

/* ------------------------------------------------------------------ */
/* The journey: positions turned into stops, travel and silences.      */
/* ------------------------------------------------------------------ */

/** Readings this close together (and close in time) are one stop. */
export const STOP_RADIUS_M = 150
/** Staying this long in one spot makes it a stop rather than a pause. */
export const STOP_MINUTES = 8
/** Faster than this between two good readings is not a real journey. */
export const JUMP_KMH = 150

export interface StopLeg {
  kind: 'stop'
  from: string
  to: string
  minutes: number
  lat: number
  lng: number
  name: string
  storeId: string | null
  inStore: boolean
  readings: number
}
export interface MoveLeg {
  kind: 'move'
  from: string
  to: string
  minutes: number
  distanceM: number
  kmh: number | null
}
export interface GapLeg {
  kind: 'gap' | 'off'
  from: string
  to: string
  minutes: number
}
export type Leg = StopLeg | MoveLeg | GapLeg

export interface Jump {
  from: string
  to: string
  distanceM: number
  kmh: number
  fromPlace: string | null
  toPlace: string | null
}

export interface Journey {
  legs: Leg[]
  jumps: Jump[]
  totals: { storeMinutes: number; elsewhereMinutes: number; movingMinutes: number; silentMinutes: number }
  stores: string[]
}

const STOP_KINDS = new Set<PointKind>(['clock_in', 'clock_out', 'visit_in', 'visit_out'])

/** Several days of trails as one, the stores listed once. */
export function mergeTrails(trails: Trail[]): Trail {
  const stores = new Map<string, TrailStore>()
  for (const t of trails) for (const s of t.stores) stores.set(s.id, s)
  return {
    person: trails.find((t) => t.person)?.person ?? null,
    date: trails[0]?.date ?? '',
    points: trails.flatMap((t) => t.points).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    stores: [...stores.values()],
  }
}

/**
 * Groups good readings into places the person stayed, the travel between
 * them, and the silences. Rough readings are left out: they would scatter
 * one stop into many. Time after a clock-out until the next reading is
 * "off", not a silence.
 */
export function journey(trail: Trail): Journey {
  const good = trail.points
    .filter((p) => (p.accuracy_m ?? 0) <= ROUGH_M)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  type Cluster = { pts: TrailPoint[]; lat: number; lng: number; store: TrailStore | null }
  const clusters: Cluster[] = []
  for (const p of good) {
    const cur = clusters[clusters.length - 1]
    const last = cur?.pts[cur.pts.length - 1]
    const store = storeAt(p, trail.stores)
    const together =
      cur &&
      last!.kind !== 'clock_out' &&
      minutesBetween(last!.at, p.at) < GAP_MINUTES &&
      (store && cur.store ? store.id === cur.store.id : metresBetween(cur.lat, cur.lng, p.lat, p.lng) <= STOP_RADIUS_M)
    if (together) {
      cur.pts.push(p)
      cur.lat += (p.lat - cur.lat) / cur.pts.length
      cur.lng += (p.lng - cur.lng) / cur.pts.length
      cur.store = cur.store ?? store
    } else {
      clusters.push({ pts: [p], lat: p.lat, lng: p.lng, store })
    }
  }

  const raw: Leg[] = []
  clusters.forEach((c, i) => {
    const first = c.pts[0]
    const last = c.pts[c.pts.length - 1]
    const minutes = minutesBetween(first.at, last.at)
    const isStop = minutes >= STOP_MINUTES || c.pts.some((p) => STOP_KINDS.has(p.kind))
    if (isStop) {
      const named = c.pts.map((p) => p.place).filter(Boolean) as string[]
      const common = named.sort((a, b) => named.filter((n) => n === b).length - named.filter((n) => n === a).length)[0]
      raw.push({
        kind: 'stop',
        from: first.at,
        to: last.at,
        minutes,
        lat: c.lat,
        lng: c.lng,
        name: c.store?.name ?? common ?? 'Unnamed spot',
        storeId: c.store?.id ?? null,
        inStore: Boolean(c.store),
        readings: c.pts.length,
      })
    } else {
      let d = 0
      for (let k = 1; k < c.pts.length; k++) d += metresBetween(c.pts[k - 1].lat, c.pts[k - 1].lng, c.pts[k].lat, c.pts[k].lng)
      raw.push({ kind: 'move', from: first.at, to: last.at, minutes, distanceM: d, kmh: null })
    }
    const next = clusters[i + 1]
    if (!next) return
    const a = last
    const b = next.pts[0]
    const between = minutesBetween(a.at, b.at)
    if (a.kind === 'clock_out') raw.push({ kind: 'off', from: a.at, to: b.at, minutes: between })
    else if (between >= GAP_MINUTES) raw.push({ kind: 'gap', from: a.at, to: b.at, minutes: between })
    else raw.push({ kind: 'move', from: a.at, to: b.at, minutes: between, distanceM: metresBetween(a.lat, a.lng, b.lat, b.lng), kmh: null })
  })

  // Back-to-back travel is one journey.
  const legs: Leg[] = []
  for (const leg of raw) {
    const prev = legs[legs.length - 1]
    if (leg.kind === 'move' && prev?.kind === 'move') {
      prev.to = leg.to
      prev.minutes += leg.minutes
      prev.distanceM += leg.distanceM
    } else {
      legs.push({ ...leg })
    }
  }
  for (const leg of legs) {
    if (leg.kind === 'move') leg.kmh = leg.minutes >= 1 ? leg.distanceM / 1000 / (leg.minutes / 60) : null
  }

  const jumps: Jump[] = []
  for (let i = 1; i < good.length; i++) {
    const a = good[i - 1]
    const b = good[i]
    const d = metresBetween(a.lat, a.lng, b.lat, b.lng)
    const hours = Math.max(minutesBetween(a.at, b.at), 0.5) / 60
    const kmh = d / 1000 / hours
    if (d > 2000 && kmh > JUMP_KMH) {
      jumps.push({ from: a.at, to: b.at, distanceM: d, kmh, fromPlace: a.place ?? storeAt(a, trail.stores)?.name ?? null, toPlace: b.place ?? storeAt(b, trail.stores)?.name ?? null })
    }
  }

  const sum = (f: (l: Leg) => boolean) => Math.round(legs.filter(f).reduce((t, l) => t + l.minutes, 0))
  return {
    legs,
    jumps,
    totals: {
      storeMinutes: sum((l) => l.kind === 'stop' && l.inStore),
      elsewhereMinutes: sum((l) => l.kind === 'stop' && !l.inStore),
      movingMinutes: sum((l) => l.kind === 'move'),
      silentMinutes: sum((l) => l.kind === 'gap'),
    },
    stores: [...new Set(legs.filter((l): l is StopLeg => l.kind === 'stop' && l.inStore).map((l) => l.name))],
  }
}
