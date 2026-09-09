import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/lib/types'

export interface Session {
  userId: string
  email: string | null
  profile: Profile
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
  return { userId: user.id, email: user.email ?? null, profile }
}

/** Page-level guard. Redirects rather than throwing. */
export async function requireSession(roles?: UserRole[]): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.profile.is_active) redirect('/deactivated')
  if (session.profile.must_change_password) redirect('/change-password')
  if (roles && !roles.includes(session.profile.role)) redirect('/')
  return session
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Route-handler guard. Throws ApiError, which the handlers turn into JSON. */
export async function requireApiSession(roles?: UserRole[]): Promise<Session> {
  const session = await getSession()
  if (!session) throw new ApiError('Not authenticated', 401)
  if (!session.profile.is_active) throw new ApiError('Account deactivated', 403)
  if (roles && !roles.includes(session.profile.role)) {
    throw new ApiError('Not permitted', 403)
  }
  return session
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return Response.json({ error: message }, { status: 500 })
}

export function landingPathFor(role: UserRole) {
  return role === 'merchandiser' ? '/field' : '/admin'
}
