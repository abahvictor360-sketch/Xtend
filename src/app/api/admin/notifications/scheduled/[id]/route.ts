import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { pushConfigured } from '@/lib/push'
import { audit } from '@/lib/audit'
import { sendScheduled, type ScheduledRow } from '@/lib/notification-send'

export const maxDuration = 60

const schema = z.object({ action: z.enum(['cancel', 'send_now']) })

/** Cancel a scheduled notification, or send it now. The sender or an admin only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: 'Which notification?' }, { status: 400 })
    }
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Cancel or send now?' }, { status: 400 })
    const supabase = await createServerSupabase()

    if (parsed.data.action === 'cancel') {
      const { error } = await supabase.rpc('cancel_scheduled_notification', { p_id: id })
      if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
      await audit(supabase, 'notification.cancel', 'scheduled_notifications', id)
      return Response.json({ ok: true })
    }

    if (!pushConfigured()) {
      return Response.json(
        { error: 'Push is not configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' },
        { status: 503 },
      )
    }
    // Take it off the schedule first, so the job cannot send it as well.
    const { data: claimed, error } = await supabase.rpc('claim_scheduled_notification', { p_id: id })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    const row = ((claimed ?? []) as ScheduledRow[])[0]
    if (!row) return Response.json({ error: 'It has already gone or been cancelled.' }, { status: 409 })

    // Re-check the reach with the person pressing the button.
    const { data: targets } = await supabase.rpc('resolve_notification_targets', {
      p_audience: 'users',
      p_detail: { user_ids: row.user_ids },
    })
    const userIds = ((targets ?? []) as { user_id: string }[]).map((t) => t.user_id)
    const result = await sendScheduled(row, { userIds, context: 'request' })
    if (!result) return Response.json({ error: 'It could not be sent. See the schedule for why.' }, { status: 400 })
    return Response.json(result)
  } catch (error) {
    return apiError(error)
  }
}
