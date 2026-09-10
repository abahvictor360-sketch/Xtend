import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, REPORTING_ROLES } from '@/lib/auth'

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  address: z.string().max(500).nullable().optional(),
  place_name: z.string().max(200).nullable().optional(),
})

/** Check out of the store. Closing a visit is a one-way door. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(REPORTING_ROLES)
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid check-out' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('end_store_visit', {
      p_visit_id: id,
      p_lat: parsed.data.lat,
      p_lng: parsed.data.lng,
      p_accuracy_m: parsed.data.accuracy_m,
      p_place_name: parsed.data.place_name ?? null,
      p_address: parsed.data.address ?? null,
    })

    if (error) {
      const status = error.message.includes('already closed')
        ? 409
        : error.message.includes('not yours')
          ? 404
          : 400
      return Response.json({ error: error.message }, { status })
    }

    return Response.json({ visit: data })
  } catch (error) {
    return apiError(error)
  }
}
