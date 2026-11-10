import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { allowAttempt, clientAddress } from '@/lib/rate-limit'
import { NO_SUCH_ACCOUNT, passwordIsRight } from '@/lib/password-check'
import { recordActivity } from '@/lib/activity-server'
import { alertNewOfficeDevice } from '@/lib/new-device-alert'
import { LAST_SEEN_COOKIE, OFFICE_SESSION_HOURS } from '@/lib/zero-trust'
import { formatLagos } from '@/lib/utils'
import { TURNSTILE_ERROR, turnstileEnabled, verifyTurnstile } from '@/lib/turnstile'
import { APP_ONLY_CODE, APP_ONLY_MESSAGE, appOnlyBlocks } from '@/lib/app-only'

const schema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
  // Cloudflare Turnstile's token, when the human check is switched on.
  turnstile: z.string().max(2048).optional(),
})

const WRONG = 'Those details are not correct.'
const WINDOW_MS = 15 * 60 * 1000
/** A random token for a phone or computer that has signed in before (0077). */
const DEVICE_COOKIE = 'xt_dev'

/**
 * Staff sign in with an email or a phone number. Supabase signs in on
 * email, so a phone is turned into the email here, on the server, and the
 * sign-in happens here too: the email never goes back to the browser, so
 * nobody can use this to find out a staff member's email from their phone
 * number. Every failure gives the same answer.
 *
 * Wrong passwords pause the phone or computer making them, not the account
 * (0077): a device that has signed in to the account before is counted on
 * its own, anything else by its address, and unknown devices together are
 * capped per account. Postgres keeps the counts and decides.
 *
 * With the Turnstile keys set, the form's human-check token is confirmed
 * with Cloudflare before the password is even looked at, so a bot without
 * one never reaches the password check.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: WRONG }, { status: 400 })
  const { identifier, password, turnstile } = parsed.data
  const address = clientAddress(request)

  const tooMany = Response.json(
    { error: 'Too many attempts. Wait 15 minutes, then try again.' },
    { status: 429 },
  )
  if (!(await allowAttempt(`sign-in:ip:${address}`, 30, WINDOW_MS))) return tooMany
  if (!(await allowAttempt(`sign-in:id:${identifier.toLowerCase()}:${address}`, 10, WINDOW_MS))) return tooMany

  if (turnstileEnabled()) {
    const human = await verifyTurnstile(turnstile, address)
    if (!human.ok) return Response.json({ error: TURNSTILE_ERROR, human_check: true }, { status: 400 })
  }

  const email = identifier.includes('@') ? identifier.toLowerCase() : await emailForPhone(identifier)

  // An identifier that matches nobody is counted the same way, so the
  // answer never says whether an account exists.
  const attempt: Attempt = {
    p_account: email ?? identifier.toLowerCase(),
    p_address: address,
    p_device: deviceHash((await cookies()).get(DEVICE_COOKIE)?.value),
  }
  const service = createAdminSupabase()
  const { data: lockedUntil } = await service.rpc('sign_in_lock_status', attempt)
  if (lockedUntil) return paused(lockedUntil as string)

  // Nobody has that phone number: still make a sign-in of the same cost,
  // so the time the answer takes does not say whether the number exists.
  if (!email) {
    await passwordIsRight(NO_SUCH_ACCOUNT, password).catch(() => false)
    return wrongPassword(service, attempt)
  }

  // The user-scoped client writes the session cookies onto this response.
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return wrongPassword(service, attempt)

  // An account an admin made app-only (0084) cannot sign in from a browser:
  // sign the session straight back out and say why. The apps get through.
  if (data.user) {
    const { data: who } = await service
      .from('profiles')
      .select('role, app_only')
      .eq('id', data.user.id)
      .maybeSingle<{ role: string; app_only: boolean | null }>()
    if (appOnlyBlocks(who, request.headers.get('user-agent'))) {
      await supabase.auth.signOut()
      return Response.json({ error: APP_ONLY_MESSAGE, code: APP_ONLY_CODE }, { status: 403 })
    }
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

  // For the office's activity log (062); never holds up the sign-in.
  if (data.user) await recordActivity(data.user.id, 'sign_in', request.headers)
  if (data.user && newDevice) await alertNewOfficeDevice(data.user.id, request.headers)

  return Response.json({ ok: true })
}

type Service = ReturnType<typeof createAdminSupabase>
type Attempt = { p_account: string; p_address: string; p_device: string | null }

/** Only the token's hash reaches the database. */
function deviceHash(token: string | undefined): string | null {
  if (!token || token.length > 100) return null
  return createHash('sha256').update(token).digest('hex')
}

async function wrongPassword(service: Service, attempt: Attempt) {
  const { data: lockedUntil } = await service.rpc('sign_in_failed', attempt)
  if (lockedUntil) return paused(lockedUntil as string)
  return Response.json({ error: WRONG }, { status: 401 })
}

function paused(until: string) {
  return Response.json(
    {
      error: `Too many wrong passwords, so signing in here is paused until ${formatLagos(until, false)}. Try again then, or ask your supervisor to unlock it.`,
      locked_until: until,
    },
    { status: 423 },
  )
}

async function emailForPhone(identifier: string): Promise<string | null> {
  const phone = identifier.replace(/[^\d+]/g, '')
  if (phone.length < 7) return null

  // Match the stored phone, and also the 0-prefixed and +234 variants of it,
  // because nobody types their number the same way twice.
  const variants = new Set([phone])
  if (phone.startsWith('0')) variants.add(`+234${phone.slice(1)}`)
  if (phone.startsWith('+234')) variants.add(`0${phone.slice(4)}`)
  if (phone.startsWith('234')) variants.add(`0${phone.slice(3)}`)

  const { data } = await createAdminSupabase()
    .from('profiles')
    .select('email')
    .in('phone', Array.from(variants))
    .eq('is_active', true)
    .limit(1)
    .maybeSingle<{ email: string | null }>()
  return data?.email ?? null
}
