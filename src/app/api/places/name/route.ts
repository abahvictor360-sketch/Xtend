import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { thingName } from '@/lib/fields'

const schema = z.object({
  due_id: z.string().uuid(),
  name: thingName(120, 'name on the store sign'),
  // The phone's GPS fix when the photos were taken; never typed.
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  storefront_path: z.string().min(1).max(300),
  selfie_path: z.string().min(1).max(300),
})

/**
 * Names a place nobody could recognise (045): the store sign from outside
 * and a selfie with our product, both live from the app's camera and
 * already checked by /api/photo-check. name_place() decides the rest.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession([...FIELD_ROLES])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid place' }, { status: 400 })
    }
    const b = parsed.data
    for (const p of [b.storefront_path, b.selfie_path]) {
      if (!p.startsWith(`${session.userId}/`)) {
        return Response.json({ error: 'That photo does not belong to you' }, { status: 400 })
      }
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('name_place', {
      p_due: b.due_id,
      p_name: b.name,
      p_lat: b.lat,
      p_lng: b.lng,
      p_accuracy_m: b.accuracy_m,
      p_storefront_path: b.storefront_path,
      p_selfie_path: b.selfie_path,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ place_id: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
