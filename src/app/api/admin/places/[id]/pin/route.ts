import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({ outlet_id: z.string().uuid() })

/**
 * Confirms that a learned place is where one of the stores waiting for a
 * location actually is. The store takes the position and is measured
 * normally from then on; the learned place goes, because the store now
 * names the spot. Postgres checks the caller is an admin and that the
 * store is still waiting (migration 030).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Choose the store' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('pin_store_from_place', {
      p_place: id,
      p_outlet: parsed.data.outlet_id,
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })

    await audit(supabase, 'place.pin_store', 'outlets', parsed.data.outlet_id, { place_id: id })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
