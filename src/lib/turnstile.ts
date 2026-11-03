/**
 * Cloudflare Turnstile: an optional "are you human?" check on the sign-in
 * form, against bots trying passwords. It is on only when both keys are
 * set (NEXT_PUBLIC_TURNSTILE_SITE_KEY for the form, TURNSTILE_SECRET_KEY
 * for the server); without them sign-in works exactly as before. The
 * widget runs in "managed" mode, so most people never see a puzzle.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
export const TURNSTILE_ERROR = 'Please confirm you are not a robot and try again.'

type Env = Record<string, string | undefined>

/** On only when both keys are present: a half-configured check stays off. */
export function turnstileEnabled(env: Env = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim())
}

/**
 * The site key for the sign-in page, or undefined when the check is off.
 * Read at request time from the same environment the sign-in route checks,
 * so the form and the server always agree on whether the check is on.
 */
export function turnstileSiteKey(env: Env = process.env): string | undefined {
  return turnstileEnabled(env) ? env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!.trim() : undefined
}

export type TurnstileResult = { ok: true } | { ok: false; reason: string }

/** Reads Cloudflare's answer. Anything but `success: true` is a failure. */
export function parseSiteverify(body: unknown): TurnstileResult {
  if (body && typeof body === 'object' && (body as { success?: unknown }).success === true) return { ok: true }
  const codes = (body as { 'error-codes'?: unknown } | null)?.['error-codes']
  return { ok: false, reason: Array.isArray(codes) && codes.length ? codes.join(',') : 'not-confirmed' }
}

/**
 * Asks Cloudflare whether the token from the form is good. A missing token,
 * a refusal, or Cloudflare not answering all fail closed: the check is only
 * switched on when the owner wants it.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
  options: { secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<TurnstileResult> {
  const secret = options.secret ?? process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: false, reason: 'no-secret' }
  if (!token || typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'missing-token' }

  const form = new URLSearchParams({ secret, response: token })
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp)

  try {
    const res = await (options.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    })
    if (!res.ok) return { ok: false, reason: `http-${res.status}` }
    return parseSiteverify(await res.json().catch(() => null))
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
