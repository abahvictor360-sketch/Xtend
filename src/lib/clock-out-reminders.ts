import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyUsers } from '@/lib/notify'
import { reminderMessage } from '@/lib/clock-out-reminder'

interface ClaimedReminder {
  user_id: string
  reminder_date: string
  stage: 1 | 2
  shift_end: string
}

/**
 * The five-minute job's part: ask everyone whose shift has ended and who
 * is still clocked in to clock out. The database hands each reminder over
 * once (claim_clock_out_reminders, migration 0061), so a run every five
 * minutes, or two at once, never sends one twice. People with the same
 * reminder and shift end share one notification, which shows in the
 * history as an automatic alert. Never throws.
 */
export async function flushClockOutReminders(): Promise<{ claimed: number; delivered: number }> {
  try {
    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('claim_clock_out_reminders')
    if (error) {
      // Before migration 0061 the function does not exist; nothing to send.
      if (!/claim_clock_out_reminders/.test(error.message)) {
        console.error('claim_clock_out_reminders failed', error.message)
      }
      return { claimed: 0, delivered: 0 }
    }
    const rows = (data ?? []) as ClaimedReminder[]
    const groups = new Map<string, ClaimedReminder[]>()
    for (const row of rows) {
      const key = `${row.stage}|${row.shift_end}|${row.reminder_date}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    let delivered = 0
    for (const group of groups.values()) {
      const { stage, shift_end, reminder_date } = group[0]
      const result = await notifyUsers(
        group.map((r) => r.user_id),
        {
          ...reminderMessage(stage, shift_end),
          detail: { kind: 'clock_out_reminder', system: true, stage, shift_end, date: reminder_date },
        },
      )
      delivered += result.delivered
    }
    return { claimed: rows.length, delivered }
  } catch (error) {
    console.error('clock-out reminders failed', error)
    return { claimed: 0, delivered: 0 }
  }
}
