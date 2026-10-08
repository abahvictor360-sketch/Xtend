import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { note } from '@/lib/fields'

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pick at least one alert').max(500, 'Resolve at most 500 alerts at a time'),
  note: note(1000),
})

/**
 * Several alerts resolved with one note. Admins only, like resolving one.
 * resolve_alerts (052) does it in one transaction with an audit row per
 * alert; before that update runs, each goes through resolve_alert in turn.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    const ids = [...new Set(parsed.data.ids)]
    const text = parsed.data.note ?? ''

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('resolve_alerts', { p_alert_ids: ids, p_note: text })
    if (!error) return Response.json({ ok: true, resolved: Number(data ?? 0) })
    if (error.code !== 'PGRST202' && error.code !== '42883') {
      return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    }

    let resolved = 0
    for (const id of ids) {
      const { error: one } = await supabase.rpc('resolve_alert', { p_alert_id: id, p_note: text })
      if (one) return Response.json({ error: dbErrorMessage(one), resolved }, { status: 400 })
      resolved += 1
    }
    return Response.json({ ok: true, resolved })
  } catch (error) {
    return apiError(error)
  }
}
