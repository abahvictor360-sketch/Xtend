import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, dbErrorMessage, requireApiSession } from '@/lib/auth'

const schema = z.object({ user_id: z.string().uuid() })

/**
 * Starts following someone live (migration 0070). The database decides:
 * admins anyone, supervisors their own team, only people clocked in and
 * not clocked out, at most follow_max_sessions at once. follow_start
 * writes the follow.start audit row (with this request's context).
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Say who to follow' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('follow_start', { p_subject: parsed.data.user_id })
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      if (missing) return Response.json({ error: 'Follow live needs the 0070 update in the database.' }, { status: 503 })
      return Response.json(
        { error: dbErrorMessage(error, 'Following could not start. Try again.'), code: error.hint ?? null },
        { status: error.hint === 'follow_cap' ? 429 : 400 },
      )
    }
    return Response.json({ session: data })
  } catch (error) {
    return apiError(error)
  }
}
