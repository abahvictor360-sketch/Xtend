import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'

const schema = z.object({ note: z.string().max(1000).default('') })

/** Resolution and its audit row are one database transaction. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid note' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('resolve_alert', {
      p_alert_id: id,
      p_note: parsed.data.note,
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
