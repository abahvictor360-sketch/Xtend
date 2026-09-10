import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, ApiError } from '@/lib/auth'

const schema = z.object({
  user_id: z.string().uuid(),
  outlet_ids: z.array(z.string().uuid()).max(200),
})

/**
 * Allocates a whole set of stores to one person. Who may do it, and whether
 * the stores exist, is decided by set_staff_outlets() — this route only
 * carries the request across.
 */
export async function PUT(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) throw new ApiError('Invalid allocation', 400)

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('set_staff_outlets', {
      p_user_id: parsed.data.user_id,
      p_outlet_ids: parsed.data.outlet_ids,
    })

    if (error) {
      const denied = /cannot change/i.test(error.message)
      throw new ApiError(error.message, denied ? 403 : 400)
    }

    return Response.json({ ok: true, outlet_ids: data ?? [] })
  } catch (error) {
    return apiError(error)
  }
}
