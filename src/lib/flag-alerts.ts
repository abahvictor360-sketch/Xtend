import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'

interface ClaimedFlag {
  id: string
  user_id: string
  staff_name: string
  kind: string
  severity: 'medium' | 'high'
  summary: string
  outlet_name: string | null
}

/** A headline a supervisor can act on from the lock screen. */
const HEADLINE: Record<string, string> = {
  late_clock_in: 'clocked in late',
  early_clock_out: 'clocked out early',
  impossible_journey: 'location jumped impossibly far',
  repeated_exact_location: 'same exact GPS point as another day',
  perfect_accuracy: 'location looks faked',
  photo_rejected: 'photo rejected',
  selfie_at_home: 'selfie taken at home',
  backdated_clock: 'clock-in time was changed',
  phone_clock_wrong: 'phone clock was changed',
  own_named_place: 'keeps using a place only they named',
  count_units_missing: 'stock missing from the count',
  count_identical: 'count copied from the last one',
  vpn_suspected: 'using a VPN',
  ip_location_mismatch: 'network is far from the GPS location',
  timezone_mismatch: 'phone set to another time zone',
  gps_mock_fingerprint: 'location looks faked',
  mock_location_confirmed: 'fake GPS app in use',
  device_integrity_failed: 'phone has been tampered with',
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
      const what = HEADLINE[flag.kind] ?? 'needs a look'
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
