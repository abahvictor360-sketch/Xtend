import 'server-only'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I or O
const DIGITS = '23456789' // no 0 or 1

/** Readable over a phone call and still not guessable. */
export function generateTempPassword() {
  const pick = (set: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)))
      .map((v) => set[v % set.length])
      .join('')
  return `${pick(ALPHABET, 3)}-${pick(DIGITS, 4)}-${pick(ALPHABET, 3)}`
}

export interface CredentialDelivery {
  full_name: string
  email: string
  phone: string | null
  temp_password: string
}

/**
 * Xpel has no SMS or email provider wired yet, so the temporary password is
 * returned to the admin who created the account and they hand it over. Point
 * CREDENTIALS_WEBHOOK_URL at a Termii/SendGrid relay to automate it; the
 * caller does not change.
 */
export async function deliverCredentials(payload: CredentialDelivery): Promise<'sent' | 'manual'> {
  const url = process.env.CREDENTIALS_WEBHOOK_URL
  if (!url) return 'manual'

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CREDENTIALS_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.CREDENTIALS_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
    })
    return res.ok ? 'sent' : 'manual'
  } catch {
    return 'manual'
  }
}
