import { vapidStatus } from '@/lib/push'
import { cronAuthorized } from '@/lib/cron'
import { healthBody } from '@/lib/health'

/**
 * Health. Publicly only `{ ok, checked_at }`, enough for Docker's
 * HEALTHCHECK and uptime monitors. With `Authorization: Bearer $CRON_SECRET`
 * it also lists which settings are configured (booleans and diagnoses,
 * never a key or any data), for checking a deploy that is not behaving.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
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
  }

  return Response.json(healthBody(cronAuthorized(request), configured, vapid, new Date().toISOString()), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
