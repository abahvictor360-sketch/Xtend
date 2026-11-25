/**
 * Reading a store's position out of what an admin pastes: a Google Maps
 * link (full or shared short link, once it has been followed), an
 * OpenStreetMap or Apple Maps link, or plain "6.6019, 3.3516". Pure, so
 * scripts/check-map-link.ts can test it.
 */

export interface LinkPoint {
  lat: number
  lng: number
}

export interface LinkReading {
  /** The position, when the text carries one. */
  point: LinkPoint | null
  /** A place name or address in the link, to search for when there is no position. */
  query: string | null
  /** A shared short link (maps.app.goo.gl, goo.gl/maps) the server must open first. */
  short: boolean
  /** The store's name, when the link carries one (/maps/place/Name,+Address/). */
  name?: string | null
  /** The address in the link, after the name. */
  address?: string | null
}

/**
 * The name and address a Google Maps link carries: "Shoprite Ikeja City
 * Mall, 194 Obafemi Awolowo Way, Ikeja" → name "Shoprite Ikeja City Mall",
 * address "194 Obafemi Awolowo Way, Ikeja". Coordinates are not a name.
 */
export function placeWords(text: string | null | undefined): { name: string | null; address: string | null } {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!t || pair(t.replace(/[()°]/g, '')) || /^-?\d/.test(t) && /^[\d\s.,°'"NSEW+-]+$/i.test(t)) return { name: null, address: null }
  const comma = t.indexOf(',')
  if (comma === -1) return { name: t.slice(0, 160), address: null }
  const name = t.slice(0, comma).trim()
  const address = t.slice(comma + 1).trim()
  // "12 Allen Avenue, Ikeja": it starts with a house number, so it is all address.
  if (/^\d+[a-z]?\s/i.test(name)) return { name: null, address: t.slice(0, 300) }
  return { name: name.slice(0, 160) || null, address: address ? address.slice(0, 300) : null }
}

/** Google's cookie page wraps the real map link in ?continue=. */
function unwrapConsent(url: URL): URL {
  if (!/^consent\./i.test(url.hostname)) return url
  const next = url.searchParams.get('continue')
  try {
    return next ? new URL(next) : url
  } catch {
    return url
  }
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`

/** Only real coordinates; 0,0 is the sea off Ghana, never a store. */
export function validPoint(lat: number, lng: number): LinkPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  if (lat === 0 && lng === 0) return null
  return { lat: round6(lat), lng: round6(lng) }
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6
}

function pair(text: string | null | undefined): LinkPoint | null {
  if (!text) return null
  const m = text.trim().match(new RegExp(String.raw`^${NUM}\s*[,;\s]\s*${NUM}$`))
  return m ? validPoint(Number(m[1]), Number(m[2])) : null
}

/** Hosts a shared map link may point at; nothing else is ever opened. */
export const SHORT_LINK_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co']
export const MAP_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co|openstreetmap\.org|apple\.com)$/i

export function isShortMapLink(url: URL) {
  const host = url.hostname.toLowerCase()
  if (host === 'maps.app.goo.gl') return true
  if (host === 'goo.gl') return url.pathname.startsWith('/maps')
  if (host === 'g.co') return url.pathname.startsWith('/kgs')
  return false
}

function decode(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/**
 * Reads what was pasted. The pin of a place (`!3d…!4d…`) wins over the map's
 * centre (`@lat,lng`), which is only where the screen was looking.
 */
export function readMapLink(input: string): LinkReading {
  const text = (input ?? '').trim()
  const none: LinkReading = { point: null, query: null, short: false }
  if (!text) return none

  // Plain coordinates, as Google Maps copies them: "6.601900, 3.351600".
  const plain = pair(text.replace(/[()°]/g, ''))
  if (plain) return { point: plain, query: null, short: false }

  const found = text.match(/https?:\/\/\S+/i)
  if (!found) return none
  let url: URL
  try {
    url = unwrapConsent(new URL(found[0]))
  } catch {
    return none
  }
  if (!MAP_HOSTS.test(url.hostname)) return none
  if (isShortMapLink(url)) return { point: null, query: null, short: true }

  const full = decode(url.href)
  // The name and address the link carries, whatever gives the position.
  const placeSeg = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/)
  const words = placeWords(placeSeg ? decode(placeSeg[1]) : url.searchParams.get('q') ?? url.searchParams.get('query'))
  const read = (point: LinkPoint | null, query: string | null = null): LinkReading => ({
    point,
    query,
    short: false,
    name: words.name,
    address: words.address,
  })

  const pin = full.match(new RegExp(String.raw`!3d${NUM}!4d${NUM}`))
  if (pin) {
    const p = validPoint(Number(pin[1]), Number(pin[2]))
    if (p) return read(p)
  }

  for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr', 'sll', 'mlat']) {
    const value = url.searchParams.get(key)
    if (key === 'mlat') {
      const lon = url.searchParams.get('mlon')
      const p = value && lon ? validPoint(Number(value), Number(lon)) : null
      if (p) return read(p)
      continue
    }
    const p = pair(value?.replace(/^loc:/i, ''))
    if (p) return read(p)
  }

  // OpenStreetMap: #map=17/6.6019/3.3516
  const osm = url.hash.match(new RegExp(String.raw`map=\d+(?:\.\d+)?/${NUM}/${NUM}`))
  if (osm) {
    const p = validPoint(Number(osm[1]), Number(osm[2]))
    if (p) return read(p)
  }

  // /maps/search/6.6019,+3.3516 or /maps/place/6.6019,3.3516
  const pathPair = full.match(new RegExp(String.raw`/(?:search|place|dir)/${NUM}\s*,\s*${NUM}`))
  if (pathPair) {
    const p = validPoint(Number(pathPair[1]), Number(pathPair[2]))
    if (p) return read(p)
  }

  const centre = full.match(new RegExp(String.raw`@${NUM},${NUM}`))
  if (centre) {
    const p = validPoint(Number(centre[1]), Number(centre[2]))
    if (p) return read(p)
  }

  // No position, but a place to search: /maps/place/Justrite+Ogba/ or ?q=Justrite Ogba
  const q = placeSeg ? decode(placeSeg[1]) : url.searchParams.get('q') ?? url.searchParams.get('query')
  const query = q?.trim() ? q.trim().slice(0, 300) : null
  return read(null, query)
}

/** A link to check a position on Google Maps. */
export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
