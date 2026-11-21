import { z } from 'zod'
import { apiError, requireApiSession } from '@/lib/auth'
import { allowAttempt } from '@/lib/rate-limit'
import { GEOCODE_LOOKUPS_PER_HOUR, HOUR_MS } from '@/lib/usage-limits'
import { openShortMapLink, searchPlaces, type LocatedPlace } from '@/lib/geocode'
import { readMapLink } from '@/lib/map-link'

export const maxDuration = 30

const schema = z.union([
  z.object({ query: z.string().trim().min(3, 'Type at least 3 letters of the address').max(400) }),
  z.object({ link: z.string().trim().min(3).max(2000) }),
])

export interface LocateAnswer {
  /** The position read from a pasted link, when there is one. */
  point: { lat: number; lng: number } | null
  /** Places that match, to pick from. */
  places: LocatedPlace[]
  error?: string
}

/**
 * Finds a new store's position for the outlet form: from the address typed
 * ("Find on map", Google then OpenStreetMap, several to pick from), or from
 * a pasted Google Maps link or "lat, lng". Nothing is saved here; the admin
 * picks a place and then saves the store as usual (audited there).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    if (!(await allowAttempt(`outlet-locate:${session.userId}`, GEOCODE_LOOKUPS_PER_HOUR, HOUR_MS))) {
      return Response.json({ error: 'Too many map searches in the last hour. Try again a little later.' }, { status: 429 })
    }
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Type an address or paste a map link' }, { status: 400 })
    }

    if ('query' in parsed.data) {
      const places = await searchPlaces(parsed.data.query)
      return Response.json({
        point: null,
        places,
        ...(places.length ? {} : { error: 'No place found for that address. Add the area and city, or paste a Google Maps link.' }),
      } satisfies LocateAnswer)
    }

    let reading = readMapLink(parsed.data.link)
    if (reading.short) {
      const url = parsed.data.link.match(/https?:\/\/\S+/i)?.[0] ?? ''
      const opened = await openShortMapLink(url)
      reading = opened ? readMapLink(opened) : { point: null, query: null, short: true }
    }
    if (reading.point) return Response.json({ point: reading.point, places: [] } satisfies LocateAnswer)
    if (reading.query) {
      const places = await searchPlaces(reading.query)
      if (places.length) return Response.json({ point: null, places } satisfies LocateAnswer)
    }
    return Response.json(
      {
        point: null,
        places: [],
        error: reading.short
          ? 'Could not open that shared link. In Google Maps, open the place, then copy the link from the address bar, or copy the numbers (like 6.6019, 3.3516).'
          : 'No position in that link. In Google Maps, press and hold the store to drop a pin, then copy the numbers or share the link.',
      } satisfies LocateAnswer,
      { status: 422 },
    )
  } catch (error) {
    return apiError(error)
  }
}
