/**
 * The plain rules of quick sign-in (0089), kept pure so
 * scripts/check-quick-sign-in.ts can test them.
 */

/** Where the app keeps its fingerprint key, in the phone's secure storage. */
export const APP_KEY_SERVER = 'xtend-sign-in'

/** A sign-in key's name as people see it: short, single-line. */
export function keyLabelFrom(line: string | null | undefined, fallback: string) {
  const text = (line ?? '').replace(/\s+/g, ' ').trim()
  return (text || fallback).slice(0, 120)
}

/**
 * What the app stores for its fingerprint key: the key's id and its
 * secret, joined so the plugin's username/password pair holds both.
 */
export function packAppKey(keyId: string, secret: string) {
  return { username: keyId, password: secret }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads it back; null when it is not a key Xtend stored. */
export function unpackAppKey(stored: { username?: unknown; password?: unknown } | null | undefined) {
  const keyId = typeof stored?.username === 'string' ? stored.username : ''
  const secret = typeof stored?.password === 'string' ? stored.password : ''
  if (!UUID.test(keyId) || secret.length < 20 || secret.length > 200) return null
  return { keyId, secret }
}

/** When the login page offers "use your fingerprint next time" again after "Not now". */
export const OFFER_AGAIN_DAYS = 30

export function offerDue(declinedAt: number | null, now: number) {
  if (!declinedAt || !Number.isFinite(declinedAt)) return true
  return now - declinedAt > OFFER_AGAIN_DAYS * 86_400_000
}
