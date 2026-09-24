import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { pushConfigured, sendPush, type PushPayload, type PushTarget } from '@/lib/push'

/**
 * Pushes one message to every device of the given people. Best effort and
 * never throws: whatever it is telling them about has already been saved.
 * Returns how many people it reached on at least one device.
 */
export async function pushToUsers(userIds: string[], payload: PushPayload) {
  if (!userIds.length || !pushConfigured()) return 0
  try {
    const admin = createAdminSupabase()
    const { data } = await admin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)
      .eq('is_active', true)
    const devices = (data ?? []) as PushTarget[]
    const results = await Promise.all(devices.map((d) => sendPush(d, payload)))
    const dead = results.filter((r) => r.gone).map((r) => r.subscriptionId)
    if (dead.length) await admin.from('push_subscriptions').update({ is_active: false }).in('id', dead)
    return new Set(results.filter((r) => r.ok).map((r) => r.userId)).size
  } catch (error) {
    console.error('push to users failed', error)
    return 0
  }
}
