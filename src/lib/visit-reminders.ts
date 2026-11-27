import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyUsers } from '@/lib/notify'
import { visitReminderMessage } from '@/lib/visit-reminder'
import { logProblem } from '@/lib/log'

interface ClaimedVisitReminder {
  user_id: string
  visit_id: string
  store: string
  since: string
  reminder: number
}

/**
 * The five-minute job's part (migration 0099): everyone still checked in at
 * a store is reminded every 25 minutes to check out before they leave. The
 * database hands each reminder over once, so overlapping runs never send
 * one twice. Never throws.
 */
export async function flushVisitCheckoutReminders(): Promise<{ claimed: number; delivered: number }> {
  try {
    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('claim_visit_checkout_reminders')
    if (error) {
      // Before migration 0099 the function does not exist; nothing to send.
      if (!/claim_visit_checkout_reminders/.test(error.message)) {
        logProblem('claim_visit_checkout_reminders failed', error.message)
      }
      return { claimed: 0, delivered: 0 }
    }
    const rows = (data ?? []) as ClaimedVisitReminder[]
    let delivered = 0
    for (const row of rows) {
      const result = await notifyUsers([row.user_id], {
        ...visitReminderMessage(row.store, row.since),
        detail: { kind: 'visit_checkout_reminder', system: true, visit_id: row.visit_id, reminder: row.reminder },
      })
      delivered += result.delivered
    }
    return { claimed: rows.length, delivered }
  } catch (error) {
    logProblem('store check-out reminders failed', error)
    return { claimed: 0, delivered: 0 }
  }
}
