import 'server-only'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolving "where is this person standing" into something a human reads as
 * a place: "Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos".
 *
 * Three sources, best first:
 *
 *  1. The assigned outlet, when the fix is inside its geofence. If someone
 *     is standing in their own store, the store's own record is the most
 *     accurate answer there is, and it costs no API call.
 *  2. Google — Places (New) for the business name, Geocoding for the street
 *     address. This is the only source that reliably names Nigerian retail
 *     premises, and it is what produces the format above. Needs
 *     GOOGLE_MAPS_API_KEY with "Places API (New)" and "Geocoding API"
 *     enabled on the project.
 *  3. OpenStreetMap — Nominatim for the address, Overpass for a named
 *     business within 80 m. Free and needs no key, but Nigerian POI
 *     coverage is thin, so it often names the street rather than the shop.
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

function join(name: string | null, address: string | null, fallback: string) {
  if (name && address) {
    // Google's formatted_address often already starts with the premises
    // name; do not say it twice.
    return address.toLowerCase().startsWith(name.toLowerCase()) ? address : `${name}, ${address}`
  }
  return name ?? address ?? fallback
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
 * the platform's shared data cache, so a store visited every day is paid
 * for once a month rather than every time.
 */
const GOOGLE_CACHE_SECONDS = 60 * 60 * 24 * 30

class NothingFound extends Error {}

const cachedGoogle = unstable_cache(
  async (lat: number, lng: number) => {
    const place = await askGoogle(lat, lng)
    // Throwing keeps a timeout or an empty answer out of the cache, so the
    // next lookup tries Google again instead of repeating a miss for a month.
    if (!place) throw new NothingFound()
    return place
  },
  ['google-place-v1'],
  { revalidate: GOOGLE_CACHE_SECONDS },
)

async function fromGoogle(lat: number, lng: number): Promise<ResolvedPlace | null> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return null
  const round = (v: number) => Math.round(v * 1e4) / 1e4
  try {
    return await cachedGoogle(round(lat), round(lng))
  } catch (error) {
    if (!(error instanceof NothingFound)) console.error('google place lookup failed', error)
    return null
  }
}

async function askGoogle(lat: number, lng: number): Promise<ResolvedPlace | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null

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
  const geocode = placeAddress
    ? null
    : await getJson<GoogleGeocode>(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`,
      )
  const address = placeAddress ?? geocode?.results?.[0]?.formatted_address ?? null

  if (!name && !address) return null

  return {
    name,
    address,
    label: join(name, address, `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
    source: 'google',
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

export interface OutletAnchor {
  name: string
  address: string | null
  lat: number
  lng: number
  radius_m: number
}

function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

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
     * The caller's own client. With it, any store the person is standing in
     * and Xtend's own list of learned places are tried before any map.
     */
    supabase?: SupabaseClient
    /** Record what a map finds, so the next person there needs no map. */
    learn?: boolean
  } = {},
): Promise<ResolvedPlace> {
  const useGoogle = options.google ?? true
  const db = options.supabase
  if (outlet) {
    const distance = metresBetween(lat, lng, outlet.lat, outlet.lng)
    if (distance <= outlet.radius_m) {
      return {
        name: outlet.name,
        address: outlet.address,
        label: join(outlet.name, outlet.address, outlet.name),
        source: 'outlet',
      }
    }
  }

  if (db) {
    const store = await fromStores(db, lat, lng)
    if (store) return store
    const known = await fromKnownPlaces(db, lat, lng)
    if (known) {
      // Counts who is seen where, so a place only its namer ever uses is
      // noticed (migration 025). Not for a preview before the clock-in.
      if (options.learn) {
        await db.rpc('note_place_visit', { p_id: known.id }).then(
          () => undefined,
          () => undefined,
        )
      }
      return known.place
    }
  }

  const mapped = (useGoogle ? await fromGoogle(lat, lng) : null) ?? (await fromOsm(lat, lng))
  if (mapped?.name && db && options.learn) {
    // Remembered, so the next person here is named from Xtend's own list.
    await db
      .rpc('learn_place', {
        p_lat: lat,
        p_lng: lng,
        p_name: mapped.name,
        p_address: mapped.address,
        p_source: mapped.source,
      })
      .then(
        () => undefined,
        () => undefined,
      )
  }

  return (
    mapped ?? {
      name: null,
      address: null,
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      source: 'coordinates',
    }
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
    data as { id: string; name: string; address: string | null; source: string; verified: boolean }[] | null
  )?.[0]
  if (!place) return null
  // A name staff typed says so until an admin has checked it, so nobody
  // reads a self-named spot as the real thing.
  const name = place.source === 'staff' && !place.verified ? `${place.name} (unverified)` : place.name
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
 */
async function locateWithGoogle(query: string): Promise<LocatedPlace | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null

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
