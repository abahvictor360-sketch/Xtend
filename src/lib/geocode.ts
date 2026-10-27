import 'server-only'
import { unstable_cache } from 'next/cache'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabase } from '@/lib/supabase/admin'
import {
  join,
  parseLimit,
  resolveWith,
  withinLimit,
  type GoogleAnswer,
  type GoogleCall,
  type LookupCount,
  type OutletAnchor,
  type ResolvedPlace,
} from '@/lib/place-resolve'

export type { OutletAnchor, PlaceSource, ResolvedPlace } from '@/lib/place-resolve'

/**
 * Resolving "where is this person standing" into something a human reads as
 * a place: "Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos".
 *
 * Xtend's own list first, a map only for somewhere new (the order is in
 * src/lib/place-resolve.ts):
 *
 *  1. Stores: the assigned outlet, then any store containing the spot.
 *  2. Places learned before (migration 024), and addresses Google gave
 *     before where there is no shop (0068). No API call.
 *  3. Google — Places (New) for the business name, Geocoding for the street
 *     address. This is the only source that reliably names Nigerian retail
 *     premises. Needs GOOGLE_MAPS_API_KEY with "Places API (New)" and
 *     "Geocoding API" enabled. Paid per request: answers are cached 30 days
 *     per spot, learned for good, counted per month (place_lookup_stats),
 *     and GOOGLE_MONTHLY_LOOKUP_LIMIT, when set, stops Google for the rest
 *     of the month once reached.
 *  4. OpenStreetMap — Nominatim for the address, Overpass for a named
 *     business within 80 m. Free and needs no key, but Nigerian POI
 *     coverage is thin, so it often names the street rather than the shop.
 */

const TIMEOUT_MS = 6000

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// The server's own access, for saved addresses and the counter (0068).
// ---------------------------------------------------------------------------

let service: SupabaseClient | null | undefined
function serviceDb(): SupabaseClient | null {
  if (service === undefined) {
    try {
      service = createAdminSupabase()
    } catch {
      service = null
    }
  }
  return service
}

/** Adds to this month's counter once the answer has gone out. */
function countLookups(what: LookupCount[]) {
  const db = serviceDb()
  if (!db || what.length === 0) return
  const task = async () => {
    await db.rpc('count_place_lookups', { p_sources: what }).then(
      () => undefined,
      () => undefined,
    )
  }
  try {
    after(task)
  } catch {
    // Outside a request: send it now, without waiting for it.
    void task()
  }
}

let warnedMonth: string | null = null

/** Google is asked only with its key set and this month's limit not reached. */
async function googleAllowed(): Promise<boolean> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return false
  const limit = parseLimit(process.env.GOOGLE_MONTHLY_LOOKUP_LIMIT)
  if (limit == null) return true
  const db = serviceDb()
  let used: number | null = null
  if (db) {
    const { data, error } = await db.rpc('google_calls_this_month')
    if (!error && data != null) used = Number(data)
  }
  const ok = withinLimit(used, limit)
  if (!ok) {
    const month = new Date().toISOString().slice(0, 7)
    if (warnedMonth !== month) {
      warnedMonth = month
      console.warn(
        `Google place lookups: this month's limit of ${limit} is reached; OpenStreetMap is used until next month`,
      )
    }
  }
  return ok
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

interface GooglePlacesNew {
  places?: {
    displayName?: { text?: string }
    formattedAddress?: string
    primaryType?: string
  }[]
}

interface GoogleGeocode {
  results?: { formatted_address?: string; types?: string[] }[]
}

/**
 * Google bills per lookup, and the same shops come up day after day. Answers
 * are kept for 30 days per spot, rounded to four decimals (about 11 m), in
 * the platform's shared data cache, on top of the places and addresses
 * Xtend keeps for good.
 */
const GOOGLE_CACHE_SECONDS = 60 * 60 * 24 * 30

class NothingFound extends Error {
  constructor(readonly calls: GoogleCall[]) {
    super('nothing found')
  }
}

interface CachedGoogle {
  place: ResolvedPlace
  /** When Google was asked: older than this lookup means the cache answered. */
  fetchedAt: number
  calls: GoogleCall[]
}

const cachedGoogle = unstable_cache(
  async (lat: number, lng: number): Promise<CachedGoogle> => {
    const { place, calls } = await askGoogle(lat, lng)
    // Throwing keeps a timeout or an empty answer out of the cache, so the
    // next lookup tries Google again instead of repeating a miss for a month.
    if (!place) throw new NothingFound(calls)
    return { place, fetchedAt: Date.now(), calls }
  },
  ['google-place-v2'],
  { revalidate: GOOGLE_CACHE_SECONDS },
)

async function fromGoogle(lat: number, lng: number): Promise<GoogleAnswer> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return { place: null, fresh: false, calls: [] }
  const round = (v: number) => Math.round(v * 1e4) / 1e4
  const started = Date.now()
  try {
    const got = await cachedGoogle(round(lat), round(lng))
    const fresh = got.fetchedAt >= started
    return { place: got.place, fresh, calls: fresh ? got.calls : [] }
  } catch (error) {
    if (error instanceof NothingFound) return { place: null, fresh: true, calls: error.calls }
    console.error('google place lookup failed', error)
    // Something was sent before it failed.
    return { place: null, fresh: true, calls: ['call_nearby'] }
  }
}

async function askGoogle(
  lat: number,
  lng: number,
): Promise<{ place: ResolvedPlace | null; calls: GoogleCall[] }> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return { place: null, calls: [] }
  const calls: GoogleCall[] = ['call_nearby']

  // Nearest establishment, ranked by distance. maxResultCount 1 keeps the
  // billed SKU small.
  const nearby = await getJson<GooglePlacesNew>(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.primaryType',
      },
      body: JSON.stringify({
        maxResultCount: 1,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 80 },
        },
      }),
    },
  )

  const place = nearby?.places?.[0]
  const name = place?.displayName?.text ?? null
  const placeAddress = place?.formattedAddress ?? null

  // The street address. Places already gives one with the business, so the
  // separately billed Geocoding call is only made when it did not.
  let geocode: GoogleGeocode | null = null
  if (!placeAddress) {
    calls.push('call_geocode')
    geocode = await getJson<GoogleGeocode>(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`,
    )
  }
  const address = placeAddress ?? geocode?.results?.[0]?.formatted_address ?? null

  if (!name && !address) return { place: null, calls }

  return {
    place: {
      name,
      address,
      label: join(name, address, `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
      source: 'google',
    },
    calls,
  }
}

// ---------------------------------------------------------------------------
// OpenStreetMap
// ---------------------------------------------------------------------------

interface NominatimResult {
  display_name?: string
  name?: string
  address?: Record<string, string>
}

interface OverpassResult {
  elements?: { tags?: Record<string, string> }[]
}

function osmAddress(address: Record<string, string> | undefined, display: string | null) {
  if (!address) return display
  const street = [address.house_number, address.road].filter(Boolean).join(' ')
  const parts = [
    street || null,
    address.neighbourhood ?? address.suburb ?? address.city_district ?? null,
    address.city ?? address.town ?? address.state ?? null,
  ].filter(Boolean) as string[]
  return parts.length ? parts.join(', ') : display
}

/** A named shop, mall or office within 80 m, closest first. */
async function osmNearbyBusiness(lat: number, lng: number) {
  const query = `[out:json][timeout:5];(
    node(around:80,${lat},${lng})[name][~"^(shop|amenity|office|building)$"~"."];
    way(around:80,${lat},${lng})[name][~"^(shop|amenity|office|building)$"~"."];
  );out tags 5;`

  const data = await getJson<OverpassResult>(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
  )
  return data?.elements?.find((el) => el.tags?.name)?.tags?.name ?? null
}

async function fromOsm(lat: number, lng: number): Promise<ResolvedPlace | null> {
  const nominatim = await getJson<NominatimResult>(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
    {
      headers: {
        'User-Agent': process.env.GEOCODER_USER_AGENT ?? 'Xtend/1.0',
        'Accept-Language': 'en',
      },
    },
  )

  const display = nominatim?.display_name ?? null
  const address = osmAddress(nominatim?.address, display)

  // Nominatim names a POI only when the fix lands on it; ask Overpass for
  // anything named nearby before giving up on a business name.
  let name = nominatim?.name || null
  if (!name) name = await osmNearbyBusiness(lat, lng)

  if (!name && !address) return null

  return {
    name,
    address,
    label: join(name, address, `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
    source: 'osm',
  }
}

// ---------------------------------------------------------------------------

/**
 * Names the spot. `outlet` is the caller's assigned store, if they have one:
 * standing inside it is answered from the store's own record rather than
 * from a guess by a mapping service.
 *
 * `google: false` is for names nobody keeps, like the home screen's "you are
 * at…" line: it goes to OpenStreetMap, which is free, and leaves the paid
 * Google lookups for clock-ins, store visits and alerts, which are recorded.
 */
export async function resolvePlace(
  lat: number,
  lng: number,
  outlet?: OutletAnchor | null,
  options: {
    google?: boolean
    /**
     * The caller's own client (or the service client, with `person`). With
     * it, any store the person is standing in and Xtend's own list of
     * learned places are tried before any map.
     */
    supabase?: SupabaseClient
    /** Record what a map finds, so the next person there needs no map. */
    learn?: boolean
    /**
     * Whose position this is, when nobody is signed in (the phone's
     * background tracker): places are learned and visits counted for them
     * through the service-role functions of migration 0068.
     */
    person?: string
  } = {},
): Promise<ResolvedPlace> {
  const db = options.supabase
  const person = options.person
  const service = serviceDb()
  // Learning for someone needs the service client: the given one if it is
  // that (the tracker passes it), else the server's own.
  const learner = person ? service ?? db : db

  return resolveWith(
    {
      store: db ? (la, ln) => fromStores(db, la, ln) : undefined,
      known: db ? (la, ln) => fromKnownPlaces(db, la, ln) : undefined,
      noteVisit: learner
        ? async (id) => {
            await (person
              ? learner.rpc('note_place_visit_for', { p_user: person, p_id: id })
              : learner.rpc('note_place_visit', { p_id: id }))
          }
        : undefined,
      savedAddress: service
        ? async (la, ln) => {
            const { data, error } = await service.rpc('address_at', { p_lat: la, p_lng: ln })
            // Before 0068 the function does not exist: go on to the maps.
            return error ? null : ((data as string | null) ?? null)
          }
        : undefined,
      googleAllowed,
      google: fromGoogle,
      osm: fromOsm,
      learnPlace: learner
        ? async (la, ln, place) => {
            const args = {
              p_lat: la,
              p_lng: ln,
              p_name: place.name,
              p_address: place.address,
              p_source: place.source,
            }
            await (person
              ? learner.rpc('learn_place_for', { p_user: person, ...args })
              : learner.rpc('learn_place', args))
          }
        : undefined,
      rememberAddress: service
        ? async (la, ln, address) => {
            await service.rpc('remember_address', { p_lat: la, p_lng: ln, p_address: address })
          }
        : undefined,
      count: countLookups,
    },
    lat,
    lng,
    outlet,
    { google: options.google, learn: options.learn },
  )
}

// ---------------------------------------------------------------------------
// Xtend's own knowledge: its stores, and the places it has learned.
// ---------------------------------------------------------------------------

/** Standing inside any store Xtend knows, whoever it is allocated to. */
async function fromStores(db: SupabaseClient, lat: number, lng: number): Promise<ResolvedPlace | null> {
  const { data: id, error } = await db.rpc('outlet_containing', { p_lat: lat, p_lng: lng })
  if (error || !id) return null
  const { data } = await db
    .from('outlets')
    .select('name, address')
    .eq('id', id as string)
    .maybeSingle<{ name: string; address: string | null }>()
  if (!data) return null
  return { name: data.name, address: data.address, label: join(data.name, data.address, data.name), source: 'outlet' }
}

/** A place somebody was at before, named then by a map or by a person. */
async function fromKnownPlaces(
  db: SupabaseClient,
  lat: number,
  lng: number,
): Promise<{ id: string; place: ResolvedPlace } | null> {
  const { data, error } = await db.rpc('known_place_at', { p_lat: lat, p_lng: lng })
  // Before migration 024 the function does not exist: fall through to the maps.
  if (error) return null
  const place = (
    data as { id: string; name: string; address: string | null }[] | null
  )?.[0]
  if (!place) return null
  // Shown as it is: staff are not told that Xtend learned it, or that an
  // admin has yet to check it. Admins see that on the Places page.
  const name = place.name
  return {
    id: place.id,
    place: { name, address: place.address, label: join(name, place.address, name), source: 'known' },
  }
}

// ---------------------------------------------------------------------------
// Forward geocoding: a store name and address in, coordinates out.
//
// This is what turns the stockist list into outlets. A geofence is useless
// without a point to measure from, and nobody is going to look up sixty sets
// of coordinates by hand.
// ---------------------------------------------------------------------------

export interface LocatedPlace {
  /** The premises as the provider names it, when it recognised one. */
  name: string | null
  /** The formatted address the provider settled on. */
  address: string | null
  lat: number
  lng: number
  source: 'google_places' | 'google_geocode' | 'osm'
}

interface GoogleTextSearch {
  places?: {
    displayName?: { text?: string }
    formattedAddress?: string
    location?: { latitude?: number; longitude?: number }
  }[]
}

interface GoogleForwardGeocode {
  results?: {
    formatted_address?: string
    geometry?: { location?: { lat?: number; lng?: number } }
  }[]
}

interface NominatimSearchResult {
  lat?: string
  lon?: string
  display_name?: string
  name?: string
}

/**
 * Text search first: "Justrite Superstore Bariga" is a business, and Places
 * pins the shop door. Plain geocoding only knows streets, so it lands on the
 * middle of the road — good enough to start a geofence from, but second best.
 * Each request is counted, and the monthly limit applies here too.
 */
async function locateWithGoogle(query: string): Promise<LocatedPlace | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key || !(await googleAllowed())) return null
  const calls: GoogleCall[] = ['call_text_search']

  try {
    const search = await getJson<GoogleTextSearch>(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 1,
          // Nigeria, so a bare "Ikeja City Mall" does not match Ikeja, Texas.
          regionCode: 'NG',
        }),
      },
    )

    const place = search?.places?.[0]
    const lat = place?.location?.latitude
    const lng = place?.location?.longitude
    if (typeof lat === 'number' && typeof lng === 'number') {
      return {
        name: place?.displayName?.text ?? null,
        address: place?.formattedAddress ?? null,
        lat,
        lng,
        source: 'google_places',
      }
    }

    calls.push('call_forward_geocode')
    const geocode = await getJson<GoogleForwardGeocode>(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=ng&key=${key}`,
    )
    const first = geocode?.results?.[0]
    const gLat = first?.geometry?.location?.lat
    const gLng = first?.geometry?.location?.lng
    if (typeof gLat === 'number' && typeof gLng === 'number') {
      return {
        name: null,
        address: first?.formatted_address ?? null,
        lat: gLat,
        lng: gLng,
        source: 'google_geocode',
      }
    }

    return null
  } finally {
    countLookups(calls)
  }
}

async function locateWithOsm(query: string): Promise<LocatedPlace | null> {
  const results = await getJson<NominatimSearchResult[]>(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ng&q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': 'Xtend/1.0 (field attendance)' } },
  )
  const first = results?.[0]
  if (!first?.lat || !first?.lon) return null

  return {
    name: first.name ?? null,
    address: first.display_name ?? null,
    lat: Number(first.lat),
    lng: Number(first.lon),
    source: 'osm',
  }
}

/**
 * Looks up one store. The name is searched together with the address,
 * because "Justrite Superstore, Bariga" finds the shop where "Bariga" alone
 * finds a suburb.
 */
export async function locateAddress(
  name: string,
  address?: string | null,
): Promise<LocatedPlace | null> {
  const query = [name, address].filter(Boolean).join(', ').trim()
  if (!query) return null
  return (await locateWithGoogle(query)) ?? (await locateWithOsm(query))
}
