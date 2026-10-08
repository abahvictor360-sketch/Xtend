import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

const schema = z.object({ policy_id: z.string().uuid() })

/** A member of staff says they have read the current scoring policy. */
export async function POST(request: Request) {
  try {
    await requireApiSession()
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('xm_mark_policy_read', { p_policy: parsed.data.policy_id })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
