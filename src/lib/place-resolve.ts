/**
 * The order in which Xtend names a spot, and the rule that keeps Google for
 * spots it has never seen. Pure: the providers are passed in, so the order
 * can be checked without a database or a network (scripts/check-places-usage.ts).
 * src/lib/geocode.ts supplies the real ones.
 *
 *   1. the person's own store, when they stand inside its geofence;
 *   2. any store Xtend knows;
 *   3. a place Xtend learned before (named by a map or by staff);
 *   4. an address Google gave before for this spot (no shop there);
 *   5. Google (its answers are also kept 30 days per spot in the server's
 *      cache), unless this is only a preview or this month's limit is used;
 *   6. OpenStreetMap, free.
 *
 * What a map finds is learned, so the next lookup there stops at 3 or 4.
 */

export type PlaceSource = 'outlet' | 'known' | 'google' | 'osm' | 'coordinates'

export interface ResolvedPlace {
  /** The business or landmark, when one could be identified. */
  name: string | null
  /** Street address, as complete as the provider gives it. */
  address: string | null
  /** What to show the user: name and address joined, or the best available. */
  label: string
  source: PlaceSource
}

export interface OutletAnchor {
  name: string
  address: string | null
  lat: number
  lng: number
  radius_m: number
}

/** Answers: who named the spot. */
export type LookupAnswer = 'store' | 'known' | 'address' | 'cache' | 'google' | 'osm' | 'none'
/** Requests actually sent to Google (each is billed). */
export type GoogleCall = 'call_nearby' | 'call_geocode' | 'call_text_search' | 'call_forward_geocode'
export type LookupCount = LookupAnswer | GoogleCall

/** Xtend's own list: no map was asked. */
export const OWN_LIST: LookupAnswer[] = ['store', 'known', 'address', 'cache']

export interface GoogleAnswer {
  place: ResolvedPlace | null
  /** False when the server's cache answered and nothing was sent to Google. */
  fresh: boolean
  calls: GoogleCall[]
}

export interface PlaceProviders {
  /** Any store containing the spot. */
  store?: (lat: number, lng: number) => Promise<ResolvedPlace | null>
  /** A learned place covering the spot. */
  known?: (lat: number, lng: number) => Promise<{ id: string; place: ResolvedPlace } | null>
  /** Counts the person as seen at a learned place. */
  noteVisit?: (id: string) => Promise<void>
  /** An address Google gave before, within its radius. */
  savedAddress?: (lat: number, lng: number) => Promise<string | null>
  /** Whether Google may be asked now (key set, monthly limit not reached). */
  googleAllowed: () => Promise<boolean>
  google: (lat: number, lng: number) => Promise<GoogleAnswer>
  osm: (lat: number, lng: number) => Promise<ResolvedPlace | null>
  /** Keeps a place a map named. */
  learnPlace?: (lat: number, lng: number, place: ResolvedPlace) => Promise<void>
  /** Keeps an address Google gave without a name. */
  rememberAddress?: (lat: number, lng: number, address: string) => Promise<void>
  /** Adds to the monthly counter; must not throw or wait. */
  count: (what: LookupCount[]) => void
}

export function join(name: string | null, address: string | null, fallback: string) {
  if (name && address) {
    // Google's formatted address often already starts with the premises
    // name; do not say it twice.
    return address.toLowerCase().startsWith(name.toLowerCase()) ? address : `${name}, ${address}`
  }
  return name ?? address ?? fallback
}

export function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const coordinates = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`

/** GOOGLE_MONTHLY_LOOKUP_LIMIT: a whole number above zero, or no limit. */
export function parseLimit(value: string | undefined | null): number | null {
  if (!value) return null
  const n = Number(value.trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Whether this month's Google requests leave room for another lookup.
 * When the count cannot be read, Google stays on: a broken counter must
 * not stop places being named.
 */
export function withinLimit(used: number | null, limit: number | null) {
  if (limit == null || used == null) return true
  return used < limit
}

export async function resolveWith(
  p: PlaceProviders,
  lat: number,
  lng: number,
  outlet?: OutletAnchor | null,
  options: { google?: boolean; learn?: boolean } = {},
): Promise<ResolvedPlace> {
  const counts: LookupCount[] = []
  try {
    if (outlet && metresBetween(lat, lng, outlet.lat, outlet.lng) <= outlet.radius_m) {
      counts.push('store')
      return {
        name: outlet.name,
        address: outlet.address,
        label: join(outlet.name, outlet.address, outlet.name),
        source: 'outlet',
      }
    }

    const store = p.store ? await p.store(lat, lng).catch(() => null) : null
    if (store) {
      counts.push('store')
      return store
    }

    const known = p.known ? await p.known(lat, lng).catch(() => null) : null
    if (known) {
      counts.push('known')
      // Counts who is seen where, so a place only its namer ever uses is
      // noticed (025). Not for a preview before the clock-in.
      if (options.learn && p.noteVisit) await p.noteVisit(known.id).catch(() => undefined)
      return known.place
    }

    const saved = p.savedAddress ? await p.savedAddress(lat, lng).catch(() => null) : null
    if (saved) {
      counts.push('address')
      return { name: null, address: saved, label: saved, source: 'google' }
    }

    let mapped: ResolvedPlace | null = null
    if ((options.google ?? true) && (await p.googleAllowed().catch(() => false))) {
      const answer = await p.google(lat, lng).catch(() => ({ place: null, fresh: false, calls: [] }) as GoogleAnswer)
      counts.push(...answer.calls)
      if (answer.place) {
        mapped = answer.place
        counts.push(answer.fresh ? 'google' : 'cache')
      }
    }
    if (!mapped) {
      mapped = await p.osm(lat, lng).catch(() => null)
      if (mapped) counts.push('osm')
    }

    if (mapped && options.learn) {
      // Remembered, so the next person here is named from Xtend's own list.
      if (mapped.name && p.learnPlace) {
        await p.learnPlace(lat, lng, mapped).catch(() => undefined)
      } else if (!mapped.name && mapped.address && mapped.source === 'google' && p.rememberAddress) {
        await p.rememberAddress(lat, lng, mapped.address).catch(() => undefined)
      }
    }

    if (mapped) return mapped
    counts.push('none')
    return { name: null, address: null, label: coordinates(lat, lng), source: 'coordinates' }
  } finally {
    p.count(counts)
  }
}

/** For the Places page: how this month's lookups were answered. */
export function lookupSummary(rows: { source: string; lookups: number }[], limit: number | null) {
  const get = (s: string) => rows.filter((r) => r.source === s).reduce((n, r) => n + Number(r.lookups), 0)
  const own = OWN_LIST.reduce((n, s) => n + get(s), 0)
  const google = get('google')
  const osm = get('osm')
  const none = get('none')
  const total = own + google + osm + none
  const calls = get('call_nearby') + get('call_geocode') + get('call_text_search') + get('call_forward_geocode')
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return {
    total,
    own,
    ownPct: pct(own),
    google,
    googlePct: pct(google),
    osm,
    osmPct: pct(osm),
    none,
    calls,
    limit,
    limitReached: limit != null && calls >= limit,
  }
}
