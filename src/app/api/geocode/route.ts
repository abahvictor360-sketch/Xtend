import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { resolvePlace, type OutletAnchor } from '@/lib/geocode'

/**
 * Names the caller's current position. Proxied server-side so the provider
 * key never reaches a handset, and so the caller's own outlet can be used
 * as the answer when they are standing in it.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiSession()
    const url = new URL(request.url)
    const lat = Number(url.searchParams.get('lat'))
    const lng = Number(url.searchParams.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    let outlet: OutletAnchor | null = null
    if (session.profile.outlet_id) {
      const supabase = await createServerSupabase()
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
    const place = await resolvePlace(lat, lng, outlet, { google: !preview })

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
