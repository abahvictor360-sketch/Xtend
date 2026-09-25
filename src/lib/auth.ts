import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/lib/types'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { lagosDateString } from '@/lib/utils'

export interface Session {
  userId: string
  email: string | null
  profile: Profile
  /** Set when a merchandiser or marketer must log in again before going on. */
  relogin: ReloginReason | null
}

/**
 * Merchandisers and marketers sign in afresh every working day: a login from
 * yesterday no longer counts, and clocking out ends the day's login. Whoever
 * holds the phone the next morning has to know the password, which stops a
 * colleague clocking in on a phone left logged in.
 */
export type ReloginReason = 'new-day' | 'clocked-out'

const DAILY_LOGIN_ROLES: UserRole[] = ['merchandiser', 'marketer']

async function reloginReason(
  supabase: SupabaseClient,
  user: User,
  profile: Profile,
): Promise<ReloginReason | null> {
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

/** Reads the session and profile. Returns null when unauthenticated. */
export async function getSession(): Promise<Session | null> {
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
  }
}

/** Page-level guard. Redirects rather than throwing. */
export async function requireSession(roles?: UserRole[]): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.profile.is_active) redirect('/deactivated')
  if (session.relogin) redirect(`/api/auth/expired?reason=${session.relogin}`)
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

/** Route-handler guard. Throws ApiError, which the handlers turn into JSON. */
export async function requireApiSession(roles?: UserRole[]): Promise<Session> {
  const session = await getSession()
  if (!session) throw new ApiError('Not authenticated', 401)
  if (!session.profile.is_active) throw new ApiError('Account deactivated', 403)
  if (session.relogin) {
    throw new ApiError(
      session.relogin === 'clocked-out'
        ? 'You have clocked out for today. Log in again to continue.'
        : 'Please log in again for today.',
      401,
      'relogin',
    )
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
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return Response.json({ error: message }, { status: 500 })
}

/** The roles that use the phone app: they clock in, out and are tracked. */
export const FIELD_ROLES: UserRole[] = ['merchandiser', 'marketer', 'admin']

/** The roles that file the daily report. Postgres enforces this too. */
export const REPORTING_ROLES: UserRole[] = ['marketer', 'admin']

export function landingPathFor(role: UserRole) {
  return role === 'merchandiser' || role === 'marketer' ? '/field' : '/admin'
}
