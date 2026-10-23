import { createAdminSupabase } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/cron'
import { purgeExpiredSelfies, purgeOrphanReportFiles } from '@/lib/retention-server'

export const maxDuration = 60

/**
 * Nightly backstop for the 24-hour photo rule. Clock and store-visit
 * selfies are normally swept by ordinary traffic within minutes of
 * expiring; this catches the ones that expired overnight, when nobody was
 * using the app. It also deletes report documents still on no report a
 * day after they were uploaded (0065).
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

  // Report documents left on no report for over a day (0065): a report
  // that never arrived or was never saved. Missing before the migration
  // runs, so a failure here is logged and the rest of the job stands.
  let reportFiles = { files_deleted: 0, failed: 0 }
  try {
    reportFiles = await purgeOrphanReportFiles(supabase)
  } catch (error) {
    console.error('report file clean-up skipped', error instanceof Error ? error.message : error)
  }
  console.log(
    `purge-selfies: ${reportFiles.files_deleted} unused report file(s) deleted, ${reportFiles.failed} failed`,
  )

  return Response.json({
    activity_cleared: activityCleared ?? 0,
    photos_deleted: purge.photos_deleted,
    records_cleared: purge.records_cleared,
    report_files_deleted: reportFiles.files_deleted,
    report_files_failed: reportFiles.failed,
    failed: purge.failed,
    visits_abandoned: abandoned ?? 0,
    ran_at: new Date().toISOString(),
  })
}
