import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'

/** The person who asked withdraws a request still waiting (cancel_leave, 059). */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(FIELD_ROLES)
    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: 'That request was not found' }, { status: 404 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('cancel_leave', { p_id: id })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
