import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'
import { allowAttempt } from '@/lib/rate-limit'
import { GEOCODE_LOOKUPS_PER_HOUR, HOUR_MS } from '@/lib/usage-limits'
import { resolvePlace, type OutletAnchor } from '@/lib/geocode'

/**
 * Names the caller's current position. Proxied server-side so the provider
 * key never reaches a handset, and so the caller's own outlet can be used
 * as the answer when they are standing in it.
 */
export async function GET(request: Request) {
  try {
    // Only the people who clock in and name stores (admins set stores up),
    // and a fair number an hour each: a Google lookup is paid per request.
    const session = await requireApiSession(FIELD_ROLES)
    if (!allowAttempt(`geocode:${session.userId}`, GEOCODE_LOOKUPS_PER_HOUR, HOUR_MS)) {
      return Response.json(
        { error: 'Too many place lookups in the last hour. Try again a little later.' },
        { status: 429 },
      )
    }
    const url = new URL(request.url)
    const lat = Number(url.searchParams.get('lat'))
    const lng = Number(url.searchParams.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    let outlet: OutletAnchor | null = null
    if (session.profile.outlet_id) {
      const { data } = await supabase
        .from('outlets')
        .select('name, address, lat, lng, geofence_radius_m')
        .eq('id', session.profile.outlet_id)
        .maybeSingle<{
          name: string
          address: string | null
          lat: number
          lng: number
          geofence_radius_m: number
        }>()

      if (data) {
        outlet = {
          name: data.name,
          address: data.address,
          lat: data.lat,
          lng: data.lng,
          radius_m: data.geofence_radius_m,
        }
      }
    }

    // A preview is only shown, never stored, so it is named with the free
    // provider; clock-ins and store visits ask without it and get Google.
    const preview = url.searchParams.get('purpose') === 'preview'
    // Stores and learned places first; a map only for somewhere new, and
    // what it finds is learned unless this is only a preview.
    const place = await resolvePlace(lat, lng, outlet, {
      google: !preview,
      supabase,
      learn: !preview,
    })

    return Response.json({
      name: place.name,
      address: place.address,
      // `place` is kept for older clients that read that field.
      place: place.label,
      label: place.label,
      source: place.source,
    })
  } catch (error) {
    return apiError(error)
  }
}
