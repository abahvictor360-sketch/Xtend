import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().trim().min(2, 'Type the name of the place').max(120),
  /** The shop-front photo, already checked by /api/photo-check. */
  photo_path: z.string().min(1).max(300),
})

/**
 * A person names a place the maps did not know. From then on everyone
 * standing there is told that name, from Xtend's own list. Limits, and
 * what happens when the place is already known, are in learn_place().
 */
export async function POST(request: Request) {
  try {
    await requireApiSession([...FIELD_ROLES])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid place' },
        { status: 400 },
      )
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('learn_place', {
      p_lat: parsed.data.lat,
      p_lng: parsed.data.lng,
      p_name: parsed.data.name,
      p_address: null,
      p_source: 'staff',
      p_photo_path: parsed.data.photo_path,
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ id: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
