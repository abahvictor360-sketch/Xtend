import 'server-only'
import { openShortMapLink, placeFromLink, resolvePlace, searchPlaces, type LocatedPlace } from '@/lib/geocode'
import { readMapLink } from '@/lib/map-link'

export interface LinkPlace {
  /** The position the link gives (the place's pin before the map's centre). */
  point: { lat: number; lng: number } | null
  /** The store's name and address, as Google Maps shows that place. */
  name: string | null
  address: string | null
  /** Places that match, to pick from, when the link names a place but gives no position. */
  places: LocatedPlace[]
  /** A short link (maps.app.goo.gl) that could not be opened. */
  short: boolean
}

/**
 * A pasted Google Maps link (or "lat, lng") read into a store's position,
 * name and address: for the outlet form ("Or paste a Google Maps link") and
 * Ask Xtend's "Add a store". The name and address are the ones Google Maps
 * shows for the place (2026-11-26): from the link when it carries them, else
 * Google Places asked for the link's name near its pin. Only without Google
 * (no key, or the month's limit) does the map at the pin fill them in.
 */
export async function placeFromMapLink(link: string): Promise<LinkPlace> {
  let reading = readMapLink(link)
  if (reading.short) {
    const url = link.match(/https?:\/\/\S+/i)?.[0] ?? ''
    const opened = await openShortMapLink(url)
    reading = opened ? readMapLink(opened) : { point: null, query: null, short: true }
  }
  if (reading.point) {
    let name = reading.name ?? null
    let address = reading.address ?? null
    if (!address || !name) {
      try {
        const google = await placeFromLink(name, reading.point.lat, reading.point.lng)
        if (google) {
          // The link's own name wins; the address is the one Google shows for the place.
          name ??= google.name
          address ??= google.address
        } else {
          const there = await resolvePlace(reading.point.lat, reading.point.lng)
          name ??= there.name
          address ??= there.address
        }
      } catch {
        // No map answered: the position alone still helps.
      }
    }
    return { point: reading.point, name, address, places: [], short: false }
  }
  if (reading.query) {
    const places = await searchPlaces(reading.query)
    // The link named the place: its own name wins over the map's.
    const named = places.map((p) => ({ ...p, name: reading.name ?? p.name, address: p.address ?? reading.address ?? null }))
    return { point: null, name: reading.name ?? null, address: reading.address ?? null, places: named, short: false }
  }
  return { point: null, name: null, address: null, places: [], short: reading.short }
}
