import { z } from 'zod'
import { zPlaceName } from '@/lib/validation'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  name: zPlaceName.optional(),
  radius_m: z.number().int().min(15).max(500).optional(),
  verified: z.boolean().optional(),
})

/** Corrects a learned place: its name, how far it reaches, or verifies it. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid change' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase.from('known_places').update(parsed.data).eq('id', id)
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'place.update', 'known_places', id, parsed.data)
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

/** Forgets a learned place, for a wrong or joke name. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const supabase = await createServerSupabase()
    const { error } = await supabase.from('known_places').delete().eq('id', id)
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'place.delete', 'known_places', id, {})
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
