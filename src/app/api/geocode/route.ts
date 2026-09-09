import { apiError, requireApiSession } from '@/lib/auth'

interface NominatimAddress {
  shop?: string
  amenity?: string
  building?: string
  mall?: string
  retail?: string
  house_number?: string
  road?: string
  neighbourhood?: string
  suburb?: string
  city_district?: string
  town?: string
  city?: string
  state?: string
}

/**
 * Builds the short label the app shows the user at the moment of capture.
 * "Ikeja City Mall, Obafemi Awolowo Way, Ikeja" reads as a place; the full
 * Nominatim display_name is a paragraph and is kept only for the record.
 */
function placeLabel(address: NominatimAddress | undefined, fallbackName: string | null) {
  if (!address) return fallbackName

  const spot =
    address.shop ??
    address.mall ??
    address.amenity ??
    address.retail ??
    address.building ??
    null

  const street = [address.house_number, address.road].filter(Boolean).join(' ') || null
  const area =
    address.neighbourhood ?? address.suburb ?? address.city_district ?? address.town ?? null
  const city = address.city ?? address.town ?? address.state ?? null

  const parts = [spot ?? fallbackName, street, area ?? city].filter(
    (part, index, all): part is string => Boolean(part) && all.indexOf(part) === index,
  )

  return parts.length ? parts.slice(0, 3).join(', ') : fallbackName
}

/**
 * Reverse geocoding proxied server-side: keeps the contact header in one
 * place, avoids CORS, and lets us fail soft. An address is a convenience,
 * never a gate — the coordinates are the record.
 */
export async function GET(request: Request) {
  try {
    await requireApiSession()
    const url = new URL(request.url)
    const lat = Number(url.searchParams.get('lat'))
    const lng = Number(url.searchParams.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    const endpoint = new URL('https://nominatim.openstreetmap.org/reverse')
    endpoint.searchParams.set('format', 'jsonv2')
    endpoint.searchParams.set('lat', String(lat))
    endpoint.searchParams.set('lon', String(lng))
    endpoint.searchParams.set('zoom', '18')
    endpoint.searchParams.set('addressdetails', '1')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': process.env.GEOCODER_USER_AGENT ?? 'Xtend/1.0',
          'Accept-Language': 'en',
        },
        signal: controller.signal,
        next: { revalidate: 0 },
      })
      if (!res.ok) throw new Error(`geocoder ${res.status}`)

      const body = (await res.json()) as {
        display_name?: string
        name?: string
        address?: NominatimAddress
      }

      return Response.json({
        address: body.display_name ?? null,
        place: placeLabel(body.address, body.name || null) ?? body.display_name ?? null,
      })
    } catch {
      // A nameless fix is still a valid fix; the app falls back to coordinates.
      return Response.json({ address: null, place: null })
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    return apiError(error)
  }
}
