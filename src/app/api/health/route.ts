import { vapidStatus } from '@/lib/push'

/**
 * Configuration health. Booleans and diagnoses — never a key, never any
 * data — so it can be checked without signing in when something is not
 * behaving.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const vapid = vapidStatus()

  const configured = {
    supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabase_anon_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    google_maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    // Both keys present, well formed, and actually a pair. Two keys from
    // different generator runs look configured and fail on every send.
    web_push: vapid.present && vapid.well_formed && vapid.matched && vapid.subject_valid,
    cron_secret: Boolean(process.env.CRON_SECRET),
  }

  return Response.json(
    {
      ok: configured.supabase_url && configured.supabase_anon_key,
      configured,
      web_push: vapid,
      place_provider: configured.google_maps
        ? 'google (with OpenStreetMap fallback)'
        : 'openstreetmap only — shop names will often be missing',
      checked_at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
