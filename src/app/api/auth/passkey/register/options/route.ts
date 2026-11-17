import { generateRegistrationOptions } from '@simplewebauthn/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { requireRecentAuth } from '@/lib/reconfirm'
import { keepChallenge, keysMissing, relyingParty } from '@/lib/quick-sign-in'

/**
 * Step 1 of adding a passkey (0089): the options the browser needs. A new
 * way into the account, so the password must have been given in the last
 * few minutes (a password sign-in counts; otherwise "Confirm it is you").
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    await requireRecentAuth(session)
    const service = createAdminSupabase()
    const { data: existing, error } = await service
      .from('sign_in_keys')
      .select('credential_id, transports')
      .eq('user_id', session.userId)
      .eq('kind', 'passkey')
    if (keysMissing(error)) {
      return Response.json({ error: 'Passkeys are not switched on yet. Ask an admin.' }, { status: 503 })
    }

    const rp = relyingParty(request)
    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName: session.profile.email ?? session.profile.full_name,
      userDisplayName: session.profile.full_name,
      userID: new TextEncoder().encode(session.userId),
      attestationType: 'none',
      // A passkey this device already holds for Xtend is not made twice.
      excludeCredentials: ((existing ?? []) as { credential_id: string; transports: string[] }[]).map((k) => ({
        id: k.credential_id,
        transports: k.transports,
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    await keepChallenge('register', options.challenge, session.userId)
    return Response.json(options)
  } catch (error) {
    return apiError(error)
  }
}
