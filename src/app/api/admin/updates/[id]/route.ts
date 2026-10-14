import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

/** Withdraws a release: its notes and its lowest app builds stop applying. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const supabase = await createServerSupabase()
    const { error } = await supabase
      .from('app_releases')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('id', id)
      .is('withdrawn_at', null)
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'app.release_withdraw', 'app_releases', id, {})
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
