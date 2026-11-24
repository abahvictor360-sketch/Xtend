import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Encrypts the AI keys an admin adds (0102) before they are stored, with
 * AES-256-GCM. The encryption key comes from AI_KEYS_SECRET, or, when that
 * is not set, from SUPABASE_SERVICE_ROLE_KEY, so it works with no extra
 * setting. Changing whichever is used means the saved AI keys must be
 * entered again. Values are never logged or sent to a browser.
 */
function boxKey(): Buffer {
  const secret = process.env.AI_KEYS_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!secret) throw new Error('No server secret to protect the AI keys with')
  return createHash('sha256').update(`xtend-ai-keys:${secret}`).digest()
}

export function seal(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
}

/** The key, or null when it cannot be read (the server secret changed). */
export function unseal(sealed: string): string | null {
  try {
    if (!sealed.startsWith('v1:')) return null
    const raw = Buffer.from(sealed.slice(3), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
