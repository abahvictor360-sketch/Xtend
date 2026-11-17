import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { recordActivity } from '@/lib/activity-server'
import { alertNewOfficeDevice } from '@/lib/new-device-alert'
import { DEFAULT_MFA_ROLES, LAST_SEEN_COOKIE, OFFICE_SESSION_HOURS } from '@/lib/zero-trust'
import { formatLagos } from '@/lib/utils'
import { APP_ONLY_CODE, APP_ONLY_MESSAGE, appOnlyBlocks } from '@/lib/app-only'
import { APP_COOKIE } from '@/lib/app-agent'
import type { UserRole } from '@/lib/types'

/**
 * What every way of signing in does once the person is proven: the
 * password (/api/auth/sign-in), a passkey or the app's fingerprint key
 * (0089). One place, so they all follow the same rules: app-only accounts
 * stay out of browsers, the device becomes known, new office devices are
 * announced, the office clocks start and the activity log hears of it.
 */

export const WRONG = 'Those details are not correct.'
/** A random token for a phone or computer that has signed in before (0077). */
export const DEVICE_COOKIE = 'xt_dev'

export type Service = ReturnType<typeof createAdminSupabase>
export type Attempt = { p_account: string; p_address: string; p_device: string | null }

/** Only the token's hash reaches the database. */
export function deviceHash(token: string | undefined): string | null {
  if (!token || token.length > 100) return null
  return createHash('sha256').update(token).digest('hex')
}

export async function attemptFor(account: string, address: string): Promise<Attempt> {
  return {
    p_account: account.toLowerCase(),
    p_address: address,
    p_device: deviceHash((await cookies()).get(DEVICE_COOKIE)?.value),
  }
}

export function paused(until: string) {
  return Response.json(
    {
      error: `Too many wrong passwords, so signing in here is paused until ${formatLagos(until, false)}. Try again then, or ask your supervisor to unlock it.`,
      locked_until: until,
    },
    { status: 423 },
  )
}

/** One cookie from the request, or null. */
export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/**
 * The person is proven: finish signing them in. `supabase` is the
 * user-scoped client that now holds their session. Returns a refusal to
 * send instead (app-only from a browser), or null when all is done.
 */
export async function finishSignIn(input: {
  service: Service
  supabase: SupabaseClient
  userId: string
  attempt: Attempt
  request: Request
  method: 'password' | 'passkey' | 'fingerprint'
}): Promise<Response | null> {
  const { service, supabase, userId, attempt, request } = input

  // An account an admin made app-only (0084) cannot sign in from a browser:
  // sign the session straight back out and say why. The apps get through.
  const { data: who } = await service
    .from('profiles')
    .select('role, app_only')
    .eq('id', userId)
    .maybeSingle<{ role: UserRole; app_only: boolean | null }>()
  if (appOnlyBlocks(who, request.headers.get('user-agent'), readCookie(request, APP_COOKIE))) {
    await supabase.auth.signOut()
    return Response.json({ error: APP_ONLY_MESSAGE, code: APP_ONLY_CODE }, { status: 403 })
  }

  // Whether this device was known to the account before (0080): a new one
  // for an office account is announced below. Asked before it is recorded.
  const { data: deviceStatus } = await service.rpc('sign_in_device_status', {
    p_account: attempt.p_account,
    p_device: attempt.p_device,
  })
  const status = deviceStatus as { known?: boolean; any_known?: boolean } | null
  const newDevice = Boolean(status && status.any_known && !status.known)

  // This device is now known to this account: a new token each sign-in.
  const token = randomBytes(32).toString('base64url')
  const { error: trustError } = await service.rpc('sign_in_succeeded', {
    ...attempt,
    p_new_device: deviceHash(token),
  })
  if (!trustError) {
    ;(await cookies()).set(DEVICE_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 180 * 24 * 60 * 60,
    })
  }

  // A fresh sign-in starts the office idle clock afresh (lib/zero-trust.ts).
  ;(await cookies()).set(LAST_SEEN_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OFFICE_SESSION_HOURS * 3600,
  })

  // The password just typed counts as a fresh confirmation (0080) for
  // anyone whose role does not also need the code; so setting up a
  // fingerprint or passkey right after signing in asks for nothing more.
  if (input.method === 'password' && who) {
    const { data: needsCode, error } = await service.rpc('mfa_required_for', { p_role: who.role })
    const required = error ? DEFAULT_MFA_ROLES.includes(who.role) : needsCode === true
    if (!required) await service.rpc('confirm_recent_auth', { p_user: userId }).then(() => undefined, () => undefined)
  }

  // For the office's activity log (062); never holds up the sign-in.
  await recordActivity(userId, 'sign_in', request.headers, { detail: { method: input.method } })
  if (newDevice) await alertNewOfficeDevice(userId, request.headers)
  return null
}

/**
 * Someone proven by a passkey or the app's fingerprint key (0089): the
 * same checks as a password sign-in (account on, device not paused), then
 * a session, then finishSignIn. The answer to send back.
 */
export async function signInProven(input: {
  service: Service
  supabase: SupabaseClient
  userId: string
  address: string
  request: Request
  method: 'passkey' | 'fingerprint'
  extra?: Record<string, unknown>
}): Promise<Response> {
  const { service, supabase, userId } = input
  const { data: person } = await service
    .from('profiles')
    .select('email, is_active')
    .eq('id', userId)
    .maybeSingle<{ email: string | null; is_active: boolean }>()
  if (!person?.is_active || !person.email) {
    return Response.json({ error: 'This account cannot sign in. Ask your supervisor.' }, { status: 403 })
  }

  const attempt = await attemptFor(person.email, input.address)
  const { data: lockedUntil } = await service.rpc('sign_in_lock_status', attempt)
  if (lockedUntil) return paused(lockedUntil as string)

  // A one-time sign-in link made and used here, on the user-scoped client,
  // which writes the session cookies. Nothing is sent to anyone.
  const { data: link, error } = await service.auth.admin.generateLink({ type: 'magiclink', email: person.email })
  const hashed = link?.properties?.hashed_token
  if (error || !hashed) {
    return Response.json({ error: 'Signing in did not work this time. Use your password.' }, { status: 502 })
  }
  const { data, error: verifyError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: hashed })
  if (verifyError || data.user?.id !== userId) {
    return Response.json({ error: 'Signing in did not work this time. Use your password.' }, { status: 502 })
  }

  const refused = await finishSignIn({ service, supabase, userId, attempt, request: input.request, method: input.method })
  if (refused) return refused
  return Response.json({ ok: true, ...(input.extra ?? {}) })
}
