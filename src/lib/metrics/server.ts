import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyUsers } from '@/lib/notify'
import { flushFlagAlerts } from '@/lib/flag-alerts'
import { windowLabel } from '@/lib/metrics/shared'

interface ClaimedExpiry {
  id: string
  outlet_name: string
  product_name: string
  batch: string
  expiry_date: string
  days_left: number
  units_on_hand: number
  consider_pulling: boolean
}

/**
 * Tells every active admin about expiry alerts nobody has heard of yet.
 * Postgres hands each one over once (xm_claim_expiry_alerts). Never throws.
 */
export async function pushExpiryAlerts(): Promise<number> {
  try {
    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('xm_claim_expiry_alerts')
    if (error) return 0
    const alerts = (data ?? []) as ClaimedExpiry[]
    if (!alerts.length) return 0

    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
    const ids = (admins ?? []).map((a: { id: string }) => a.id)

    // One message, not one per batch: a delivery can carry dozens.
    const pull = alerts.filter((a) => a.consider_pulling)
    const lines = alerts.slice(0, 4).map((a) => {
      const when = a.days_left < 0 ? 'expired' : `${windowLabel(a.days_left)} left`
      return `${a.product_name}${a.batch ? ` (${a.batch})` : ''} at ${a.outlet_name}: ${a.units_on_hand} units, ${when}`
    })
    const more = alerts.length > 4 ? ` and ${alerts.length - 4} more` : ''
    await notifyUsers(ids, {
      title: pull.length
        ? `Expiry: consider pulling ${pull.length} batch${pull.length === 1 ? '' : 'es'}`
        : `Expiry: ${alerts.length} batch${alerts.length === 1 ? '' : 'es'} nearing expiry`,
      body: `${lines.join('; ')}${more}.`,
      url: '/admin/metrics/expiry',
      detail: { kind: 'xm_expiry', alert_ids: alerts.map((a) => a.id) },
    })
    return alerts.length
  } catch (error) {
    console.error('expiry alerts failed', error)
    return 0
  }
}

/**
 * The X Metrics sweep: reconcile counts whose day has ended, look for
 * batches entering an expiry window, then tell people. Safe to run as
 * often as wanted; each step does nothing the second time.
 */
export async function runMetricsSweep(client?: SupabaseClient) {
  const db = client ?? createAdminSupabase()
  const reconciled = await db.rpc('xm_reconcile_pending')
  const scanned = await db.rpc('xm_expiry_scan')
  if (reconciled.error) console.error('xm_reconcile_pending failed', reconciled.error.message)
  if (scanned.error) console.error('xm_expiry_scan failed', scanned.error.message)
  const expiry_alerts = await pushExpiryAlerts()
  const flags = await flushFlagAlerts()
  return {
    reconciled: (reconciled.data as number | null) ?? 0,
    new_expiry_alerts: (scanned.data as number | null) ?? 0,
    expiry_alerts_sent: expiry_alerts,
    flags_sent: flags,
  }
}
