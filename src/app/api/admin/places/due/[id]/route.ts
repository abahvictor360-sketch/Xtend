import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { writtenText } from '@/lib/fields'

const schema = z.object({ reason: writtenText(300, 3, 'the reason') })

/**
 * Lets someone off naming a place (045): it was not a shop, say. Admins,
 * or the person's own supervisor; dismiss_place_due() checks which.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Say why' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('dismiss_place_due', { p_due: id, p_reason: parsed.data.reason })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    if (session.profile.role === 'admin') {
      await audit(supabase, 'place_due.dismiss', 'place_naming_due', id, parsed.data)
    }
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
