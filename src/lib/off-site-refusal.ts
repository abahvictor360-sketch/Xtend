/**
 * Off site (0106): the database refused the clock-in or check-in and named
 * the store to go to. Passed on with the store, so the app can show the way.
 */
export function offSiteRefusal(error: { hint?: string | null; details?: string | null; message: string }): Response | null {
  if (error.hint !== 'off_site') return null
  let offSite: unknown = null
  try {
    offSite = error.details ? JSON.parse(error.details) : null
  } catch {
    offSite = null
  }
  return Response.json({ error: error.message, code: 'off_site', off_site: offSite }, { status: 422 })
}

/**
 * Too early (0109): the database refused a clock-out before their
 * clock-out time. Passed on with the time, so the app can say it.
 */
export function tooEarlyRefusal(error: { hint?: string | null; details?: string | null; message: string }): Response | null {
  if (error.hint !== 'too_early') return null
  let opensAt: string | null = null
  try {
    opensAt = (JSON.parse(error.details ?? '{}') as { opens_at?: string }).opens_at ?? null
  } catch {
    opensAt = null
  }
  return Response.json({ error: error.message, code: 'too_early', opens_at: opensAt }, { status: 422 })
}
