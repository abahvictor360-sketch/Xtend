import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SELFIE_RETENTION_HOURS, SELFIE_SWEEP_EVERY_MINUTES } from '@/lib/retention'

export interface SweepResult {
  /** False when the throttle said it was not due yet. */
  ran: boolean
  photos_deleted: number
  records_cleared: number
  failed: number
}

const IDLE: SweepResult = { ran: false, photos_deleted: 0, records_cleared: 0, failed: 0 }

/**
 * Deletes every clock and store-visit photo older than the retention
 * window, then clears the paths that pointed at them.
 *
 * The objects go through the Storage API rather than a SQL DELETE: Supabase
 * guards storage.objects with a trigger that rejects direct deletes. The
 * order matters — remove the files first, forget the paths second, so a
 * failure leaves something to retry rather than a row that has forgotten
 * an image still sitting in the bucket.
 *
 * Needs the service-role client; nothing here is callable by a user.
 */
export async function purgeExpiredSelfies(
  admin: SupabaseClient,
  hours = SELFIE_RETENTION_HOURS,
): Promise<SweepResult> {
  const { data, error } = await admin.rpc('expired_selfie_paths', { p_hours: hours })
  if (error) throw new Error(error.message)

  const paths = ((data ?? []) as { path: string }[]).map((row) => row.path).filter(Boolean)

  let deleted = 0
  let failed = 0

  // The Storage API takes a bounded list, and a whole day of a large team
  // is more than one call should carry.
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { data: removed, error: removeError } = await admin.storage
      .from('selfies')
      .remove(batch)
    if (removeError) {
      failed += batch.length
      console.error('selfie purge failed for a batch', removeError.message)
      continue
    }
    deleted += removed?.length ?? 0
  }

  // Only forget the paths once nothing is left to delete. A partial failure
  // keeps them, and the next sweep picks the same rows up again.
  let cleared = 0
  if (failed === 0) {
    const { data: rows, error: forgetError } = await admin.rpc('forget_expired_selfies', {
      p_hours: hours,
    })
    if (forgetError) throw new Error(forgetError.message)
    cleared = (rows as number) ?? 0
  }

  return { ran: true, photos_deleted: deleted, records_cleared: cleared, failed }
}

/**
 * The same sweep, but only if it has not run recently. Safe to call from an
 * ordinary request: the database decides whether this caller does the work,
 * and every other caller returns immediately.
 */
export async function sweepExpiredSelfies(
  admin: SupabaseClient,
  minutes = SELFIE_SWEEP_EVERY_MINUTES,
): Promise<SweepResult> {
  const { data: due, error } = await admin.rpc('claim_selfie_sweep', { p_min_minutes: minutes })
  if (error) throw new Error(error.message)
  if (due !== true) return IDLE

  const result = await purgeExpiredSelfies(admin)
  await admin.rpc('record_selfie_sweep', {
    p_result: {
      photos_deleted: result.photos_deleted,
      records_cleared: result.records_cleared,
      failed: result.failed,
      at: new Date().toISOString(),
    },
  })
  return result
}
