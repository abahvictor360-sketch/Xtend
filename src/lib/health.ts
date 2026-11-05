/**
 * What /api/health answers. Anybody may ask whether the app is up (Docker's
 * HEALTHCHECK, the deploy script, uptime monitors only need the 200), so the
 * public answer is just that. Which services are configured, and why web
 * push is failing, is shown only to a caller with the CRON_SECRET bearer
 * token, because it tells an outsider what to aim at.
 */
export interface HealthConfigured {
  supabase_url: boolean
  supabase_anon_key: boolean
  supabase_service_role: boolean
  google_maps: boolean
  google_maps_browser: boolean
  web_push: boolean
  cron_secret: boolean
}

export function healthBody(
  detailed: boolean,
  configured: HealthConfigured,
  webPush: unknown,
  checkedAt: string,
): Record<string, unknown> {
  const ok = configured.supabase_url && configured.supabase_anon_key
  if (!detailed) return { ok, checked_at: checkedAt }
  return {
    ok,
    configured,
    web_push: webPush,
    place_provider: configured.google_maps
      ? 'google (with OpenStreetMap fallback)'
      : 'openstreetmap only — shop names will often be missing',
    checked_at: checkedAt,
  }
}
