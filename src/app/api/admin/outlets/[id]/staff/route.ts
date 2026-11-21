import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, ApiError, dbErrorMessage } from '@/lib/auth'

const schema = z.object({
  user_id: z.string().guid(),
  /** true adds the person at this store, false takes them off it. */
  on: z.boolean(),
})

/**
 * Allocates one person to (or off) one store, from that store on Outlets.
 * set_store_staff() (0097) decides who may and audits it; their other
 * stores are left alone.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || !z.string().guid().safeParse(id).success) throw new ApiError('Invalid allocation', 400)
    const { user_id, on } = parsed.data

    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_store_staff', { p_outlet: id, p_user: user_id, p_on: on })

    if (error && (error.code === 'PGRST202' || error.code === '42883')) {
      // 0097 not run yet: the whole-list allocation (set_staff_outlets) does
      // the same, with the same checks and audit row.
      const { data: row } = await supabase
        .from('staff_allocation')
        .select('outlet_ids')
        .eq('user_id', user_id)
        .maybeSingle<{ outlet_ids: string[] }>()
      if (!row) throw new ApiError('You cannot change that person’s stores', 403)
      const current = row.outlet_ids ?? []
      const wanted = on ? [...new Set([...current, id])] : current.filter((o) => o !== id)
      const { error: whole } = await supabase.rpc('set_staff_outlets', { p_user_id: user_id, p_outlet_ids: wanted })
      if (whole) throw denied(whole)
      return Response.json({ ok: true })
    }
    if (error) throw denied(error)
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

function denied(error: { code?: string; message: string }) {
  const refused = error.code === 'P0001' && /cannot change/i.test(error.message)
  return new ApiError(dbErrorMessage(error, 'The store could not be allocated. Try again.'), refused ? 403 : 400)
}
