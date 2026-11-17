import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { allowAttempt, clientAddress } from '@/lib/rate-limit'
import { NO_SUCH_ACCOUNT, passwordIsRight } from '@/lib/password-check'
import { TURNSTILE_ERROR, turnstileEnabled, verifyTurnstile } from '@/lib/turnstile'
import { WRONG, attemptFor, finishSignIn, paused, type Attempt, type Service } from '@/lib/sign-in-finish'

const schema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
  // Cloudflare Turnstile's token, when the human check is switched on.
  turnstile: z.string().max(2048).optional(),
})

const WINDOW_MS = 15 * 60 * 1000

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
  const attempt = await attemptFor(email ?? identifier, address)
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

  if (!data.user) return wrongPassword(service, attempt)
  const refused = await finishSignIn({ service, supabase, userId: data.user.id, attempt, request, method: 'password' })
  if (refused) return refused

  return Response.json({ ok: true })
}

async function wrongPassword(service: Service, attempt: Attempt) {
  const { data: lockedUntil } = await service.rpc('sign_in_failed', attempt)
  if (lockedUntil) return paused(lockedUntil as string)
  return Response.json({ error: WRONG }, { status: 401 })
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
