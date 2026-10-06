import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'
import { flagHeadline } from '@/lib/flag-labels'

interface ClaimedFlag {
  id: string
  user_id: string
  staff_name: string
  kind: string
  severity: 'medium' | 'high'
  summary: string
  outlet_name: string | null
}

/**
 * Pushes every medium or high integrity flag nobody has been told about to
 * that person's admins and supervisor. Postgres hands each flag over once
 * (claim_flag_alerts, migration 036), so callers can run this as often as
 * they like: after a clock-in, a ping, a photo, a count, and on the cron.
 * Never throws.
 */
export async function flushFlagAlerts(): Promise<number> {
  try {
    const { data, error } = await createAdminSupabase().rpc('claim_flag_alerts', { p_limit: 50 })
    // Before migration 036 there is nothing to claim.
    if (error) return 0
    const flags = (data ?? []) as ClaimedFlag[]
    for (const flag of flags) {
      const what = flagHeadline(flag.kind)
      await notifyWatchers({
        subjectId: flag.user_id,
        title: `${flag.staff_name}: ${what}`,
        body: `${flag.summary}${flag.outlet_name && !flag.summary.includes(flag.outlet_name) ? ` (${flag.outlet_name})` : ''}.`,
        url: '/admin/integrity',
        detail: { kind: 'integrity_flag', flag_id: flag.id, flag_kind: flag.kind, severity: flag.severity },
      })
    }
    return flags.length
  } catch (error) {
    console.error('flag alerts failed', error)
    return 0
  }
}
