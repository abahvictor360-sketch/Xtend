import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

/** Removes a date change, so the weekly pattern applies again (audited in 059). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: 'That date change was not found' }, { status: 404 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('remove_schedule_override', { p_id: id })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
