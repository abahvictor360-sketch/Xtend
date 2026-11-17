import { apiError, requireApiSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { auditKey } from '@/lib/quick-sign-in'

/** Removes one of the person's own fingerprint or passkey sign-ins (0089). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession()
    const { id } = await ctx.params
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('remove_my_sign_in_key', { p_id: id })
    if (error) return Response.json({ error: 'That could not be removed. Try again.' }, { status: 400 })
    if (data !== true) return Response.json({ error: 'That sign-in is already removed.' }, { status: 404 })
    await auditKey(createAdminSupabase(), session.userId, 'auth.key_remove', { key_id: id })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
