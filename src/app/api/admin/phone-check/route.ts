import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'
import { pushToUsers } from '@/lib/push-users'
import { pushConfigured } from '@/lib/push'

const schema = z.object({ user_id: z.string().uuid() })

/**
 * "Check the phone now". A push goes to the person's phone, and the phone
 * reports that it arrived: then it is on, with network, right now. Who may
 * check whom is decided by request_phone_check() (migration 026).
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Pick a person' }, { status: 400 })
    if (!pushConfigured()) {
      return Response.json({ error: 'Notifications are not set up on the server.' }, { status: 503 })
    }

    const supabase = await createServerSupabase()
    const { data: id, error } = await supabase.rpc('request_phone_check', {
      p_user: parsed.data.user_id,
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })

    const admin = createAdminSupabase()
    const { data: check } = await admin
      .from('phone_checks')
      .select('id, token, devices, created_at')
      .eq('id', id as string)
      .single<{ id: string; token: string; devices: number; created_at: string }>()
    if (!check) return Response.json({ error: 'The check could not be started.' }, { status: 500 })

    // One already running (sent in the last two minutes): keep waiting on it.
    if (check.devices > 0) return Response.json({ id: check.id, reached: true })

    const reached = await pushToUsers([parsed.data.user_id], {
      title: 'Xtend',
      body: 'Please open Xtend now.',
      url: '/field',
      notificationId: `check-${check.id}`,
      check: { id: check.id, token: check.token },
    })
    await admin.from('phone_checks').update({ devices: reached }).eq('id', check.id)
    return Response.json({ id: check.id, reached: reached > 0 })
  } catch (error) {
    return apiError(error)
  }
}
