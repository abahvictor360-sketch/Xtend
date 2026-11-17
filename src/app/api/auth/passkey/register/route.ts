import { z } from 'zod'
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { apiError, requireApiSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { requireRecentAuth } from '@/lib/reconfirm'
import { auditKey, keyLabel, relyingParty, takeChallenge } from '@/lib/quick-sign-in'

const schema = z.object({ response: z.record(z.string(), z.unknown()) })

/** Step 2 of adding a passkey (0089): check what the browser made, keep its public key. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    await requireRecentAuth(session)
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'That passkey could not be read.' }, { status: 400 })

    const expectedChallenge = await takeChallenge('register', session.userId)
    if (!expectedChallenge) {
      return Response.json({ error: 'That took too long. Try adding the passkey again.' }, { status: 400 })
    }

    const rp = relyingParty(request)
    let verification
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      })
    } catch {
      return Response.json({ error: 'That passkey could not be checked. Try again.' }, { status: 400 })
    }
    if (!verification.verified) {
      return Response.json({ error: 'That passkey could not be checked. Try again.' }, { status: 400 })
    }

    const { credential } = verification.registrationInfo
    const label = keyLabel(request, 'Passkey')
    const service = createAdminSupabase()
    const { error } = await service.from('sign_in_keys').insert({
      user_id: session.userId,
      kind: 'passkey',
      label,
      credential_id: credential.id,
      public_key: isoBase64URL.fromBuffer(credential.publicKey),
      sign_count: credential.counter,
      transports: credential.transports ?? [],
    })
    if (error) {
      if (error.code === '23505') return Response.json({ error: 'This passkey is already added.' }, { status: 409 })
      return Response.json({ error: 'The passkey could not be saved. Try again.' }, { status: 500 })
    }
    await auditKey(service, session.userId, 'auth.key_add', { kind: 'passkey', label })
    return Response.json({ ok: true, label }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
