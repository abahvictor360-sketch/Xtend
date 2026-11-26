import { z } from 'zod'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { googlePutsThemAtStore } from '@/lib/store-google'

const schema = z.object({
  store_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative().nullable(),
})

/**
 * The phone measured "off site" from the store's pin: before it says so,
 * it asks here whether Google puts the store where they are standing
 * (0114). Only a yes or no; the database still decides when the clock-in
 * or check-in is sent.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid' }, { status: 400 })
    const b = parsed.data
    // Only a store they can see (RLS), for its area.
    const supabase = await createServerSupabase()
    const { data: store } = await supabase.from('outlets').select('id, geofence_radius_m').eq('id', b.store_id).maybeSingle()
    if (!store) return Response.json({ at_store: false })
    const radius = (store as { geofence_radius_m: number | null }).geofence_radius_m
    const atStore = await googlePutsThemAtStore(b.store_id, b, radius)
    return Response.json({ at_store: atStore })
  } catch (error) {
    return apiError(error)
  }
}
