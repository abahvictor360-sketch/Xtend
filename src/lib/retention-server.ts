import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyUsers } from '@/lib/notify'
import { SELFIE_RETENTION_HOURS, groupRetentionNotices, type RetentionDue } from '@/lib/retention'

/**
 * The nightly clean-up (0067). Nothing goes before it is 14 days old, and
 * nothing the database did not announce at least a day before: every
 * listing below stops at the previous night's announcement. Reports, and
 * the photos and documents on a report, are never listed.
 *
 * The objects go through the Storage API rather than a SQL DELETE:
 * Supabase guards storage.objects with a trigger that rejects direct
 * deletes. Needs the service-role client; nothing here is callable by a
 * user.
 */

export interface SweepResult {
  photos_deleted: number
  records_cleared: number
  failed: number
}

async function removeInBatches(admin: SupabaseClient, bucket: string, paths: string[], what: string) {
  let deleted = 0
  let failed = 0
  const done: string[] = []
  // The Storage API takes a bounded list.
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { data: removed, error } = await admin.storage.from(bucket).remove(batch)
    if (error) {
      failed += batch.length
      console.error(`${what} clean-up failed for a batch`, error.message)
      continue
    }
    deleted += removed?.length ?? 0
    done.push(...batch)
  }
  return { deleted, failed, done }
}

/**
 * Deletes clock-in and store-visit photos past the rule, then forgets
 * exactly the paths whose batch went through, so a failure leaves
 * something to retry rather than a row that has forgotten an image still
 * in the bucket. The time, place and distance are kept.
 */
export async function purgeExpiredSelfies(
  admin: SupabaseClient,
  hours = SELFIE_RETENTION_HOURS,
): Promise<SweepResult> {
  const { data, error } = await admin.rpc('expired_selfie_paths', { p_hours: hours })
  if (error) throw new Error(error.message)

  const paths = ((data ?? []) as { path: string }[]).map((row) => row.path).filter(Boolean)
  const { deleted, failed, done } = await removeInBatches(admin, 'selfies', paths, 'selfie')

  let cleared = 0
  if (done.length) {
    const { data: rows, error: forgetError } = await admin.rpc('forget_selfie_paths', { p_paths: done })
    if (forgetError) throw new Error(forgetError.message)
    cleared = (rows as number) ?? 0
  }
  return { photos_deleted: deleted, records_cleared: cleared, failed }
}

export interface OrphanSweepResult {
  files_deleted: number
  failed: number
}

/**
 * Deletes report documents (0064) on no report once the rule allows:
 * uploads whose report never arrived or was never saved (0065, 0067).
 * A file the job misses is picked up the next night.
 */
export async function purgeOrphanReportFiles(admin: SupabaseClient): Promise<OrphanSweepResult> {
  const { data, error } = await admin.rpc('report_file_orphans', { p_hours: SELFIE_RETENTION_HOURS, p_limit: 1000 })
  if (error) throw new Error(error.message)
  const paths = ((data ?? []) as { path: string }[]).map((row) => row.path).filter(Boolean)
  const { deleted, failed } = await removeInBatches(admin, 'report-files', paths, 'report file')
  return { files_deleted: deleted, failed }
}

/**
 * Deletes report photos on no report once the rule allows (0067): uploads
 * whose report never arrived, and the copies older app versions uploaded
 * again on every retry. Only report photo names are ever listed; the
 * count, store and place photos sharing the bucket are not.
 */
export async function purgeOrphanReportPhotos(admin: SupabaseClient): Promise<OrphanSweepResult> {
  const { data, error } = await admin.rpc('report_photo_orphans', { p_hours: SELFIE_RETENTION_HOURS, p_limit: 1000 })
  if (error) throw new Error(error.message)
  const paths = ((data ?? []) as { path: string }[]).map((row) => row.path).filter(Boolean)
  const { deleted, failed } = await removeInBatches(admin, 'reports', paths, 'report photo')
  return { files_deleted: deleted, failed }
}

export interface NoticeResult {
  /** Admins and supervisors told tonight. */
  notified: number
  /** Everything older than this goes on the next night. */
  through: string | null
}

/**
 * Announces what goes on the next night and tells every admin all of it
 * and each supervisor their own team's, at most once a day each. Staff
 * are never told. Run after tonight's deletions, so it speaks of what is
 * left.
 */
export async function sendRetentionNotices(admin: SupabaseClient): Promise<NoticeResult> {
  const { data: through, error } = await admin.rpc('retention_announce')
  if (error) throw new Error(error.message)
  if (!through) return { notified: 0, through: null }

  const { data: due, error: dueError } = await admin.rpc('retention_notice_due', { p_through: through })
  if (dueError) throw new Error(dueError.message)

  let notified = 0
  for (const group of groupRetentionNotices((due ?? []) as RetentionDue[], through as string)) {
    await notifyUsers(group.userIds, {
      ...group.message,
      detail: { kind: 'retention_notice', system: true, through },
    })
    notified += group.userIds.length
  }
  return { notified, through: through as string }
}

/** Keeps what was deleted, and audits it (retention.purge) when anything was. */
export async function recordRetentionPurge(admin: SupabaseClient, result: Record<string, unknown>) {
  const { error } = await admin.rpc('record_retention_purge', { p_result: result })
  if (error) console.error('retention record failed', error.message)
}
