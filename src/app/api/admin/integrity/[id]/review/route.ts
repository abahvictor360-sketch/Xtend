import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

const schema = z.object({ note: z.string().trim().max(500).nullable().optional() })

/** Marks a flag as looked at. Who may is decided by review_integrity_flag(). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid note' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('review_integrity_flag', {
      p_id: id,
      p_note: parsed.data.note ?? null,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
