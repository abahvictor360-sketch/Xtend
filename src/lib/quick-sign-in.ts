import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { publicOrigin } from '@/lib/origin'
import { parseUserAgent, auditContext } from '@/lib/audit-context'
import { deviceLine } from '@/lib/zero-trust'
import type { Service } from '@/lib/sign-in-finish'
import { keyLabelFrom } from '@/lib/quick-sign-in-rules'

/**
 * Signing in with a fingerprint, face or passkey (0089). Passkeys are for
 * the website (WebAuthn); the apps keep a secret behind the fingerprint.
 * See lib/quick-sign-in-rules.ts for the parts the checks script tests.
 */

/** The cookie holding a passkey challenge between its two steps. */
const CHALLENGE_COOKIE = 'xt_wa'
const CHALLENGE_SECONDS = 5 * 60

/** The site a passkey belongs to, and the page origin it must come from. */
export function relyingParty(request: Request) {
  const origin = publicOrigin(request)
  return { origin, rpID: new URL(origin).hostname, rpName: 'Xtend' }
}

/** Keeps a challenge for this browser, for one purpose, for five minutes. */
export async function keepChallenge(purpose: 'register' | 'sign-in', challenge: string, userId = '') {
  ;(await cookies()).set(CHALLENGE_COOKIE, [purpose, userId, challenge].join('.'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: CHALLENGE_SECONDS,
  })
}

/** Takes the challenge back (once): null when missing, expired or for something else. */
export async function takeChallenge(purpose: 'register' | 'sign-in', userId = ''): Promise<string | null> {
  const jar = await cookies()
  const value = jar.get(CHALLENGE_COOKIE)?.value ?? ''
  jar.delete({ name: CHALLENGE_COOKIE, path: '/api/auth' })
  const [p, u, challenge] = value.split('.')
  if (p !== purpose || u !== userId || !challenge) return null
  return challenge
}

/** A new secret for the app's fingerprint key, and the hash the server keeps. */
export function newAppSecret() {
  const secret = randomBytes(32).toString('base64url')
  return { secret, hash: secretHash(secret) }
}

export function secretHash(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}

/** Whether a secret matches the stored hash, in constant time. */
export function secretMatches(secret: string, storedHash: string | null) {
  if (!storedHash || typeof secret !== 'string' || secret.length < 20 || secret.length > 200) return false
  const a = Buffer.from(secretHash(secret), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** "Chrome on Android (phone)", from the browser's own description. */
export function keyLabel(request: Request, fallback: string) {
  return keyLabelFrom(deviceLine(parseUserAgent(request.headers.get('user-agent'))), fallback)
}

/** The audit trail for adding or removing a sign-in key. */
export async function auditKey(
  service: Service,
  userId: string,
  action: 'auth.key_add' | 'auth.key_remove' | 'auth.key_reset',
  meta: Record<string, unknown>,
) {
  try {
    await service.from('audit_log').insert({
      actor_id: userId,
      action,
      target_table: 'sign_in_keys',
      target_id: userId,
      meta: { ...meta, _context: await auditContext() },
    })
  } catch {
    // The audit row never stops the change itself.
  }
}

/** Whether 0089 has not been run yet (the table is missing). */
export function keysMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /sign_in_keys/.test(error.message ?? '')
}
