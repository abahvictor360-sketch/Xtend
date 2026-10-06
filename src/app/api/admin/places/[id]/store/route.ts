import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  geofence_radius_m: z.number().int().min(25).max(2000).default(150),
})

/**
 * Turns a learned place into one of the company's stores, at the position
 * staff actually stood. From then on it has a geofence, can be allocated,
 * and clock-ins there are measured against it. The learned place is
 * removed, because the store now names the spot.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid store' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { data: place, error: readError } = await supabase
      .from('known_places')
      .select('name, address, lat, lng')
      .eq('id', id)
      .maybeSingle<{ name: string; address: string | null; lat: number; lng: number }>()
    if (readError || !place) return Response.json({ error: 'That place no longer exists.' }, { status: 404 })

    const { data: outlet, error } = await supabase
      .from('outlets')
      .insert({
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        geofence_radius_m: parsed.data.geofence_radius_m,
      })
      .select('id')
      .single<{ id: string }>()
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    await supabase.from('known_places').delete().eq('id', id)
    await audit(supabase, 'place.make_store', 'outlets', outlet.id, { place_id: id, name: place.name })
    return Response.json({ outlet_id: outlet.id }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
