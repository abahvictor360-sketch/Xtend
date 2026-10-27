import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyUsers } from '@/lib/notify'
import { soonMessage, type SoonStage } from '@/lib/shift-reminder'

interface ClaimedSoon {
  user_id: string
  reminder_date: string
  stage: SoonStage
  shift_time: string
  store: string | null
}

/** History kind for each heads-up. */
const KIND: Record<SoonStage, string> = {
  clock_in_soon: 'clock_in_reminder',
  clock_out_soon: 'clock_out_soon',
}

/**
 * The five-minute job's part for the heads-ups (migration 0069): "Time to
 * clock in" five minutes before the shift starts, and "Your shift ends at
 * HH:MM" five minutes before it ends. The database hands each one over
 * once, and only inside its five minutes, so a late run sends nothing
 * stale. People with the same message share one notification, shown in
 * the history as an automatic alert. Never throws.
 */
export async function flushShiftSoonReminders(): Promise<{ claimed: number; delivered: number }> {
  try {
    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('claim_shift_soon_reminders')
    if (error) {
      // Before migration 0069 the function does not exist; nothing to send.
      if (!/claim_shift_soon_reminders/.test(error.message)) {
        console.error('claim_shift_soon_reminders failed', error.message)
      }
      return { claimed: 0, delivered: 0 }
    }
    const rows = (data ?? []) as ClaimedSoon[]
    const groups = new Map<string, ClaimedSoon[]>()
    for (const row of rows) {
      const key = `${row.stage}|${row.shift_time}|${row.reminder_date}|${row.stage === 'clock_in_soon' ? (row.store ?? '') : ''}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    let delivered = 0
    for (const group of groups.values()) {
      const { stage, shift_time, reminder_date, store } = group[0]
      const result = await notifyUsers(
        group.map((r) => r.user_id),
        {
          ...soonMessage(stage, shift_time, store),
          detail: { kind: KIND[stage], system: true, stage, shift_time, date: reminder_date },
        },
      )
      delivered += result.delivered
    }
    return { claimed: rows.length, delivered }
  } catch (error) {
    console.error('shift heads-ups failed', error)
    return { claimed: 0, delivered: 0 }
  }
}
