import { createAdminSupabase } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/cron'
import {
  purgeExpiredSelfies,
  purgeOrphanReportFiles,
  purgeOrphanReportPhotos,
  recordRetentionPurge,
  sendRetentionNotices,
} from '@/lib/retention-server'

export const maxDuration = 60

/**
 * The nightly clean-up (0067). Clock-in and store-visit photos, and report
 * photos and documents on no report, are deleted 14 days after they were
 * taken or uploaded, and only after admins and supervisors were told the
 * night before: the database lists nothing that was not announced.
 * Reports, and the photos and documents on a report, are never deleted.
 * After deleting, the job announces what goes next night and notifies the
 * office. Staff are never told.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()

  let purge
  try {
    purge = await purgeExpiredSelfies(supabase)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Purge failed' },
      { status: 500 },
    )
  }

  // A marketer who forgot to check out should not still read as "in store"
  // tomorrow morning, so yesterday's open visits are marked abandoned.
  const { data: abandoned } = await supabase.rpc('close_abandoned_visits')

  // What phones reported about themselves (migration 026) is evidence for
  // settling an excuse, which nobody raises two months later.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('device_beacons').delete().lt('received_at', cutoff)
  await supabase.from('phone_checks').delete().lt('created_at', cutoff)

  // The activity log (062) keeps 180 days. Missing before the migration runs.
  const { data: activityCleared } = await supabase.rpc('purge_user_activity')

  // Report documents and photos left on no report (0065, 0067): a report
  // that never arrived or was never saved, and copies an older app sent
  // again on a retry. A failure here is logged and the rest of the job
  // stands.
  let reportFiles = { files_deleted: 0, failed: 0 }
  try {
    reportFiles = await purgeOrphanReportFiles(supabase)
  } catch (error) {
    console.error('report file clean-up skipped', error instanceof Error ? error.message : error)
  }
  let reportPhotos = { files_deleted: 0, failed: 0 }
  try {
    reportPhotos = await purgeOrphanReportPhotos(supabase)
  } catch (error) {
    console.error('report photo clean-up skipped', error instanceof Error ? error.message : error)
  }

  const result = {
    photos_deleted: purge.photos_deleted,
    records_cleared: purge.records_cleared,
    failed: purge.failed,
    report_files_deleted: reportFiles.files_deleted,
    report_files_failed: reportFiles.failed,
    report_photos_deleted: reportPhotos.files_deleted,
    report_photos_failed: reportPhotos.failed,
  }
  console.log(
    `purge-selfies: ${purge.photos_deleted} clock photo file(s), ${reportPhotos.files_deleted} unused report ` +
      `photo(s), ${reportFiles.files_deleted} unused report file(s) deleted; ` +
      `${purge.failed + reportPhotos.failed + reportFiles.failed} failed`,
  )
  await recordRetentionPurge(supabase, { ...result, at: new Date().toISOString() })

  // Tomorrow's deletions, announced tonight to admins and supervisors.
  let notices = { notified: 0, through: null as string | null }
  try {
    notices = await sendRetentionNotices(supabase)
  } catch (error) {
    console.error('retention notices skipped', error instanceof Error ? error.message : error)
  }

  return Response.json({
    activity_cleared: activityCleared ?? 0,
    ...result,
    notices_sent: notices.notified,
    next_deletion_before: notices.through,
    visits_abandoned: abandoned ?? 0,
    ran_at: new Date().toISOString(),
  })
}
