import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({ minutes: z.number().int().min(0).max(600) })

/** How long location may stay off on shift before the supervisor is told (0115; 0 never). */
export async function PATCH(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Give the minutes as a number from 0 to 600' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_location_off_alert_minutes', { p_minutes: parsed.data.minutes })
    if (error) {
      const missing = /set_location_off_alert_minutes/.test(error.message) && /function|schema cache/i.test(error.message)
      return Response.json({ error: missing ? 'This needs migration 0115 run in Supabase.' : dbErrorMessage(error) }, { status: 400 })
    }
    await audit(supabase, 'location_off.minutes', 'system_settings', null, { minutes: parsed.data.minutes })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
