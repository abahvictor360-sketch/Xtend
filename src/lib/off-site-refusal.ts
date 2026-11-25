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
