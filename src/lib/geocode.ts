import 'server-only'

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

export type PlaceSource = 'outlet' | 'google' | 'osm' | 'coordinates'

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

async function fromGoogle(lat: number, lng: number): Promise<ResolvedPlace | null> {
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

  // The street address, independent of whether a business was found.
  const geocode = await getJson<GoogleGeocode>(
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
 */
export async function resolvePlace(
  lat: number,
  lng: number,
  outlet?: OutletAnchor | null,
): Promise<ResolvedPlace> {
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

  return (
    (await fromGoogle(lat, lng)) ??
    (await fromOsm(lat, lng)) ?? {
      name: null,
      address: null,
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      source: 'coordinates',
    }
  )
}
