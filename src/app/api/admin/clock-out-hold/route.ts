import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, dbErrorMessage, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notifyUsers } from '@/lib/notify'

const schema = z.object({ user_id: z.string().guid(), hold: z.boolean() })

/**
 * The office switches one person's clock-out hold (0111): on, they cannot
 * clock out before their clock-out time (0109); off, they can clock out
 * now. Postgres decides who may (an admin, HR, or their supervisor).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor', 'hr'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Check the details.' }, { status: 400 })
    const { user_id, hold } = parsed.data
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_clock_out_hold', { p_user: user_id, p_hold: hold })
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      return Response.json(
        { error: missing ? 'This needs migration 0111. Ask an admin to run it.' : dbErrorMessage(error) },
        { status: missing ? 503 : error.message === 'Not permitted' ? 403 : 400 },
      )
    }
    await audit(supabase, hold ? 'staff.clock_out_hold_on' : 'staff.clock_out_hold_off', 'profiles', user_id, { hold })
    if (!hold) {
      await notifyUsers([user_id], {
        title: 'You can clock out now',
        body: `${session.profile.full_name} has let you clock out before your clock-out time.`,
        url: '/field',
        senderId: session.userId,
        detail: { kind: 'clock_out_hold', hold },
      })
    }
    return Response.json({ ok: true, hold })
  } catch (error) {
    return apiError(error)
  }
}
