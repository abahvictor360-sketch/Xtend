import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'

const schema = z.object({
  reason: z.enum(['permission_denied', 'position_unavailable', 'low_accuracy', 'unsupported']),
  accuracy_m: z.number().nonnegative().nullable().optional(),
})

/** Every blocked location attempt is recorded. A blocked user is a signal. */
export async function POST(request: Request) {
  try {
    await requireApiSession()
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid reason' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('log_location_block', {
      p_reason: parsed.data.reason,
      p_accuracy_m: parsed.data.accuracy_m ?? null,
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })

    return Response.json({ logged: true })
  } catch (error) {
    return apiError(error)
  }
}
