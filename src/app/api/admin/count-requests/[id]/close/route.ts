import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

/** Closes a count request early. Only whoever asked, or an admin, may. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { id } = await ctx.params
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('close_count_request', { p_request_id: id })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
