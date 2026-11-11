import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/lib/types'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { lagosDateString } from '@/lib/utils'
import { CHANGE_PASSWORD_CODE, CHANGE_PASSWORD_MESSAGE, passwordChangeBlocks } from '@/lib/password-gate'
import { APP_ONLY_CODE, APP_ONLY_MESSAGE, APP_ONLY_PATH, appOnlyBlocks } from '@/lib/app-only'
import { APP_COOKIE } from '@/lib/app-agent'
import {
  DEFAULT_MFA_ROLES,
  LAST_SEEN_HEADER,
  OFFICE_ROLES,
  mfaStep,
  officeRelogin,
  type MfaStep,
} from '@/lib/zero-trust'

export interface Session {
  userId: string
  email: string | null
  profile: Profile
  /**
   * Set when the person must log in again before going on: a field
   * sign-in from yesterday or after clocking out, or an office sign-in
   * past 12 hours or idle for an hour (zero trust, lib/zero-trust.ts).
   */
  relogin: ReloginReason | null
  /** Two-step sign-in (0080): what is still to do, if anything. */
  mfa: { step: MfaStep | null; enrolled: boolean; required: boolean }
}

/**
 * Merchandisers and marketers sign in afresh every working day: a login from
 * yesterday no longer counts, and clocking out ends the day's login. Whoever
 * holds the phone the next morning has to know the password, which stops a
 * colleague clocking in on a phone left logged in.
 */
export type ReloginReason = 'new-day' | 'clocked-out' | 'office-time' | 'idle'

const DAILY_LOGIN_ROLES: UserRole[] = ['merchandiser', 'marketer']

async function reloginReason(
  supabase: SupabaseClient,
  user: User,
  profile: Profile,
): Promise<ReloginReason | null> {
  if (OFFICE_ROLES.includes(profile.role)) {
    // The middleware hands over when this browser last made a request.
    const seen = Number((await headers()).get(LAST_SEEN_HEADER))
    return officeRelogin({
      role: profile.role,
      lastSignInAt: user.last_sign_in_at ?? null,
      lastSeenMs: Number.isFinite(seen) && seen > 0 ? seen : null,
      now: Date.now(),
    })
  }
  if (!DAILY_LOGIN_ROLES.includes(profile.role)) return null
  const today = lagosDateString()
  // Africa/Lagos is UTC+1 all year.
  const dayStart = new Date(`${today}T00:00:00+01:00`)
  const signedIn = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null
  if (!signedIn || signedIn < dayStart) return 'new-day'

  const { data: closing } = await supabase
    .from('attendance')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('attendance_date', today)
    .eq('type', 'closing')
    .limit(1)
    .maybeSingle<{ created_at: string }>()
  if (closing && new Date(closing.created_at) > signedIn) return 'clocked-out'
  return null
}

/** Share auth/profile checks across layouts and pages within one render only. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<Profile>()

  if (!profile) return null
  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    relogin: await reloginReason(supabase, user, profile),
    mfa: await mfaState(supabase, profile),
  }
})

/**
 * Two-step sign-in for this session. Field staff never set it up, so they
 * are not asked. Whether a role must use it is the database's answer
 * (my_mfa_required, 0080); before that migration runs, admins and HR.
 */
async function mfaState(supabase: SupabaseClient, profile: Profile): Promise<Session['mfa']> {
  if (!OFFICE_ROLES.includes(profile.role)) {
    return { step: null, enrolled: false, required: false }
  }
  const [{ data: level }, { data: needed, error }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('my_mfa_required'),
  ])
  const required = error ? DEFAULT_MFA_ROLES.includes(profile.role) : needed === true
  const enrolled = level?.nextLevel === 'aal2'
  return { step: mfaStep({ required, enrolled, aal: level?.currentLevel ?? null }), enrolled, required }
}

/**
 * Whether this request must be sent to the app (0084): the app's user agent,
 * or the xt_app cookie it left for the page loads Android's service worker
 * makes without that user agent.
 */
export async function appOnlyHere(profile: Session['profile']) {
  const [h, c] = await Promise.all([headers(), cookies()])
  return appOnlyBlocks(profile, h.get('user-agent'), c.get(APP_COOKIE)?.value)
}

/** Page-level guard. Redirects rather than throwing. */
export async function requireSession(roles?: UserRole[]): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.profile.is_active) redirect('/deactivated')
  // An admin made this account app-only (0084): a browser is sent to the page
  // that says so. The apps announce themselves in their user agent.
  if (await appOnlyHere(session.profile)) redirect(APP_ONLY_PATH)
  if (session.relogin) redirect(`/api/auth/expired?reason=${session.relogin}`)
  if (session.mfa.step === 'challenge') redirect('/mfa')
  if (session.mfa.step === 'setup') redirect('/mfa/setup')
  if (session.profile.must_change_password) redirect('/change-password')
  if (roles && !roles.includes(session.profile.role)) redirect('/')
  return session
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

/**
 * Route-handler guard. Throws ApiError, which the handlers turn into JSON.
 * Somebody who must choose their own password is refused (403,
 * code 'change_password') unless the route is one the change needs.
 */
export async function requireApiSession(
  roles?: UserRole[],
  {
    allowDuringPasswordChange = false,
    allowBeforeMfa = false,
  }: { allowDuringPasswordChange?: boolean; allowBeforeMfa?: boolean } = {},
): Promise<Session> {
  const session = await getSession()
  if (!session) throw new ApiError('Not authenticated', 401)
  if (!session.profile.is_active) throw new ApiError('Account deactivated', 403)
  if (await appOnlyHere(session.profile)) {
    throw new ApiError(APP_ONLY_MESSAGE, 403, APP_ONLY_CODE)
  }
  if (session.relogin) {
    throw new ApiError(
      session.relogin === 'clocked-out'
        ? 'You have clocked out for today. Log in again to continue.'
        : 'Please log in again for today.',
      401,
      'relogin',
    )
  }
  if (!allowBeforeMfa && session.mfa.step === 'challenge') {
    throw new ApiError('Enter the code from your authenticator app first.', 401, 'mfa')
  }
  if (!allowBeforeMfa && session.mfa.step === 'setup') {
    throw new ApiError('Set up two-step sign-in first.', 403, 'mfa_setup')
  }
  if (passwordChangeBlocks(Boolean(session.profile.must_change_password), allowDuringPasswordChange)) {
    throw new ApiError(CHANGE_PASSWORD_MESSAGE, 403, CHANGE_PASSWORD_CODE)
  }
  if (roles && !roles.includes(session.profile.role)) {
    throw new ApiError('Not permitted', 403)
  }
  return session
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status },
    )
  }
  // Anything else is a fault, not an answer: its text can name tables,
  // columns or services, so it goes to the server log and not the caller.
  console.error('unexpected API error', error)
  return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
}

/**
 * What a database error may tell the caller. A message a Postgres function
 * raises on purpose (SQLSTATE P0001) is written for people, so it is passed
 * on. Anything else (a constraint, a column, a policy) describes the
 * database, so it is logged and the caller gets the fallback.
 */
export function dbErrorMessage(
  error: { code?: string; message: string } | null | undefined,
  fallback = 'That could not be saved. Try again.',
): string {
  if (error?.code === 'P0001') return error.message
  if (error) console.error('database error', error)
  return fallback
}

/**
 * The response for a refused write. A place waiting to be named (045) is
 * 423, not 400: the submission is fine and is sent again once the place is
 * named, so the phone keeps it rather than discarding it.
 */
export function dbErrorResponse(
  error: { code?: string; message: string; hint?: string | null },
  fallback?: string,
) {
  if (error.hint === 'place_naming_due') {
    return Response.json({ error: error.message, code: 'name_place' }, { status: 423 })
  }
  return Response.json({ error: dbErrorMessage(error, fallback) }, { status: 400 })
}

/** The roles that use the phone app: they clock in, out and are tracked. */
export const FIELD_ROLES: UserRole[] = ['merchandiser', 'marketer', 'admin']

/** The roles that file the daily report. Postgres enforces this too. */
export const REPORTING_ROLES: UserRole[] = ['marketer', 'admin']

export function landingPathFor(role: UserRole) {
  return role === 'merchandiser' || role === 'marketer' ? '/field' : '/admin'
}
