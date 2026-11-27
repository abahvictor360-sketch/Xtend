import { vapidStatus } from '@/lib/push'
import { cronAuthorized } from '@/lib/cron'
import { healthBody } from '@/lib/health'
import { redisReachable } from '@/lib/redis'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { logError } from '@/lib/log'

/**
 * Health. Publicly only `{ ok, checked_at }`, enough for Docker's
 * HEALTHCHECK and uptime monitors. With `Authorization: Bearer $CRON_SECRET`
 * it also lists which settings are configured (booleans and diagnoses,
 * never a key or any data), for checking a deploy that is not behaving.
 */
export const dynamic = 'force-dynamic'

async function handleGet(request: Request) {
  const vapid = vapidStatus()

  const configured = {
    supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabase_anon_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    google_maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    // The office maps' Google base map (separate, browser-restricted key).
    google_maps_browser: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY),
    // Both keys present, well formed, and actually a pair. Two keys from
    // different generator runs look configured and fail on every send.
    web_push: vapid.present && vapid.well_formed && vapid.matched && vapid.subject_valid,
    cron_secret: Boolean(process.env.CRON_SECRET),
    redis: Boolean(process.env.REDIS_URL),
  }

  // Redis is pinged only for the detailed answer, never for Docker's checks.
  const detailed = cronAuthorized(request)
  const reachable = detailed ? await redisReachable().catch(() => false) : null
  const body = healthBody(detailed, configured, vapid, new Date().toISOString(), reachable)
  // Detailed: problems in the last hour and day, and each job's last run (0117).
  if (detailed) {
    try {
      const { data } = await createAdminSupabase().rpc('error_summary')
      body.problems = data ?? null
    } catch {
      body.problems = null
    }
  }
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

// The health check itself never crashes: a fault answers 503 with ok false.
export async function GET(request: Request) {
  try {
    return await handleGet(request)
  } catch (error) {
    logError('health.failed', error)
    return Response.json({ ok: false, checked_at: new Date().toISOString() }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
