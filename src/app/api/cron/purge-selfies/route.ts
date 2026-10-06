import { createAdminSupabase } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/cron'
import { purgeExpiredSelfies } from '@/lib/retention-server'

export const maxDuration = 60

/**
 * Nightly backstop for the 24-hour photo rule. Clock and store-visit
 * selfies are normally swept by ordinary traffic within minutes of
 * expiring; this catches the ones that expired overnight, when nobody was
 * using the app.
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

  return Response.json({
    photos_deleted: purge.photos_deleted,
    records_cleared: purge.records_cleared,
    failed: purge.failed,
    visits_abandoned: abandoned ?? 0,
    ran_at: new Date().toISOString(),
  })
}
