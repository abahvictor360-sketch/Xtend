/**
 * Configuration health. Booleans only — never a key, never any data — so
 * it can be checked without signing in when something is not behaving.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const configured = {
    supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabase_anon_key: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    google_maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    web_push: Boolean(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
    ),
    cron_secret: Boolean(process.env.CRON_SECRET),
  }

  return Response.json(
    {
      ok: configured.supabase_url && configured.supabase_anon_key,
      configured,
      place_provider: configured.google_maps
        ? 'google (with OpenStreetMap fallback)'
        : 'openstreetmap only — shop names will often be missing',
      checked_at: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
