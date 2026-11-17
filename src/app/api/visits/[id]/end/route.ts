import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { mapText } from '@/lib/fields'
import { placeForEvent } from '@/lib/geocode'
import { isOwnStoragePath } from '@/lib/storage-path'

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  address: mapText(500),
  place_name: mapText(200),
  // The check-out selfie (0091), in the person's own folder.
  selfie_path: z.string().min(1).max(300).nullable().optional(),
  thumb_path: z.string().min(1).max(300).nullable().optional(),
})

/** Check out of the store. Closing a visit is a one-way door. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid check-out' }, { status: 400 })
    }

    for (const path of [parsed.data.selfie_path, parsed.data.thumb_path]) {
      if (path && !isOwnStoragePath(path, session.userId)) {
        return Response.json({ error: 'Selfie path does not belong to you' }, { status: 400 })
      }
    }

    const supabase = await createServerSupabase()
    // The phone could not name the spot: name and save it here.
    const found = await placeForEvent(supabase, parsed.data.lat, parsed.data.lng, parsed.data)
    const args = {
      p_visit_id: id,
      p_lat: parsed.data.lat,
      p_lng: parsed.data.lng,
      p_accuracy_m: parsed.data.accuracy_m,
      p_place_name: parsed.data.place_name ?? found?.name ?? null,
      p_address: parsed.data.address ?? found?.address ?? null,
    }
    let { data, error } = await supabase.rpc('end_store_visit', {
      ...args,
      p_selfie_path: parsed.data.selfie_path ?? null,
      p_thumb_path: parsed.data.thumb_path ?? null,
    })
    // Before migration 0091 the function takes no photo: check out without
    // it rather than leave the person stuck in the store.
    if (error && checkoutWithoutPhoto(error)) {
      ;({ data, error } = await supabase.rpc('end_store_visit', args))
    }

    if (error) {
      const status = error.message.includes('already closed')
        ? 409
        : error.message.includes('photo is not yours')
          ? 400
          : error.message.includes('not yours')
            ? 404
            : 400
      return Response.json({ error: dbErrorMessage(error) }, { status })
    }

    return Response.json({ visit: data })
  } catch (error) {
    return apiError(error)
  }
}

/** The database has no end_store_visit with the photo arguments yet (before 0091). */
function checkoutWithoutPhoto(error: { code?: string; message: string }) {
  return error.code === 'PGRST202' || /p_selfie_path|could not find the function/i.test(error.message)
}
