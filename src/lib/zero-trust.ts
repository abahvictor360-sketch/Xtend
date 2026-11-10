import type { UserRole } from '@/lib/types'

/**
 * Zero trust: every request proves who it is and that it came from Xtend
 * itself, whatever network it came over. The rules, kept pure so
 * scripts/check-zero-trust.ts can check them; the database enforces the
 * same ones for admin and HR power (migration 0080).
 */

/** People who use the office dashboard. Field staff already sign in daily. */
export const OFFICE_ROLES: UserRole[] = ['supervisor', 'admin', 'hr']

/** An office sign-in lasts at most this long, however busy. */
export const OFFICE_SESSION_HOURS = 12
/** An office sign-in ends after this long with no request at all. */
export const OFFICE_IDLE_MINUTES = 60
/** Risky actions need the password (and code) confirmed this recently. */
export const RECONFIRM_MINUTES = 10
/** Roles that must use two-step sign-in when the database cannot say (before 0080 runs). */
export const DEFAULT_MFA_ROLES: UserRole[] = ['admin', 'hr']

/** The cookie the middleware keeps with the time of the last request. */
export const LAST_SEEN_COOKIE = 'xt_seen'
/** The header the middleware hands the app with the previous request's time. */
export const LAST_SEEN_HEADER = 'x-xt-last-seen'

export type OfficeRelogin = 'office-time' | 'idle'

/** Whether an office sign-in has run out: too long, or idle too long. */
export function officeRelogin(input: {
  role: UserRole
  lastSignInAt: string | null
  lastSeenMs: number | null
  now: number
}): OfficeRelogin | null {
  if (!OFFICE_ROLES.includes(input.role)) return null
  const signedIn = input.lastSignInAt ? Date.parse(input.lastSignInAt) : NaN
  if (!Number.isFinite(signedIn) || input.now - signedIn > OFFICE_SESSION_HOURS * 3_600_000) return 'office-time'
  if (input.lastSeenMs != null && input.now - input.lastSeenMs > OFFICE_IDLE_MINUTES * 60_000) return 'idle'
  return null
}

export type MfaStep = 'challenge' | 'setup'

/**
 * What a person must do before going on: enter their code (they have an
 * authenticator set up and this session has not used it yet), or set one
 * up (their role needs it and they have none). Null: nothing.
 */
export function mfaStep(input: { required: boolean; enrolled: boolean; aal: string | null }): MfaStep | null {
  if (input.enrolled && input.aal !== 'aal2') return 'challenge'
  if (input.required && !input.enrolled) return 'setup'
  return null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/**
 * Routes that change things without a browser: the scheduled jobs (bearer
 * secret) and the phone's native tracker (its own token). No cookie is
 * involved in either, so a forged cross-site request has nothing to ride on.
 */
const NO_BROWSER_PREFIXES = ['/api/cron/', '/api/track/']

/**
 * Whether a request that changes something came from Xtend's own pages.
 * A browser always says where a request comes from (Origin, or
 * Sec-Fetch-Site); another site's page can make a signed-in person's
 * browser send a request, and this refuses it. A request with neither
 * header is not from a browser, so it carries no victim's cookies.
 */
export function originAllowed(input: {
  method: string
  path: string
  host: string | null
  origin: string | null
  secFetchSite: string | null
}): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true
  if (!input.path.startsWith('/api/')) return true
  if (NO_BROWSER_PREFIXES.some((p) => input.path.startsWith(p))) return true
  if (input.origin && input.origin !== 'null') {
    let originHost: string
    try {
      originHost = new URL(input.origin).host
    } catch {
      return false
    }
    return Boolean(input.host) && originHost.toLowerCase() === input.host!.toLowerCase()
  }
  if (input.origin === 'null') return false
  const site = input.secFetchSite?.toLowerCase()
  if (site === 'cross-site' || site === 'same-site') return false
  return true
}

/** The device line for a new-device alert, from the browser's own description. */
export function deviceLine(
  device: { type: 'phone' | 'tablet' | 'computer'; os: string | null; browser: string | null; app: boolean } | null,
): string {
  if (!device) return 'an unknown phone or computer'
  const what = device.app ? 'the Xtend app' : device.browser
  const parts = [what, device.os].filter(Boolean)
  return parts.length ? `${parts.join(' on ')} (${device.type})` : `a ${device.type}`
}
