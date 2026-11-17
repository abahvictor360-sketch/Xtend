import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { allowAttempt, clientAddress } from '@/lib/rate-limit'
import { keepChallenge, relyingParty } from '@/lib/quick-sign-in'

/**
 * Step 1 of signing in with a passkey (0089), signed out: a challenge for
 * any passkey this device holds for Xtend (the browser offers its own).
 */
export async function POST(request: Request) {
  const address = clientAddress(request)
  if (!(await allowAttempt(`passkey:ip:${address}`, 30, 15 * 60 * 1000))) {
    return Response.json({ error: 'Too many attempts. Wait 15 minutes, then try again.' }, { status: 429 })
  }
  const rp = relyingParty(request)
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required' })
  await keepChallenge('sign-in', options.challenge)
  return Response.json(options)
}
