import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
})

/** Foreground heartbeat. The geofence decision is a database trigger. */
export async function POST(request: Request) {
  try {
    await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid ping' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('location_pings')
      .insert(parsed.data)
      .select('id, distance_m, created_at')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ ping: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
