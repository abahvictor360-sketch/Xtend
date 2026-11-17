import { z } from 'zod'
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { allowAttempt, clientAddress } from '@/lib/rate-limit'
import { relyingParty, takeChallenge } from '@/lib/quick-sign-in'
import { signInProven } from '@/lib/sign-in-finish'

const schema = z.object({
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
})

const NOT_KNOWN = 'That passkey is not set up for Xtend any more. Sign in with your password.'

/**
 * Step 2 of signing in with a passkey (0089): the device signed the
 * challenge with a passkey; the stored public key checks it. Then the same
 * rules as a password sign-in (lib/sign-in-finish.ts).
 */
export async function POST(request: Request) {
  const address = clientAddress(request)
  if (!(await allowAttempt(`passkey:ip:${address}`, 30, 15 * 60 * 1000))) {
    return Response.json({ error: 'Too many attempts. Wait 15 minutes, then try again.' }, { status: 429 })
  }
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'That passkey could not be read.' }, { status: 400 })

  const expectedChallenge = await takeChallenge('sign-in')
  if (!expectedChallenge) return Response.json({ error: 'That took too long. Try again.' }, { status: 400 })

  const service = createAdminSupabase()
  const { data: key } = await service
    .from('sign_in_keys')
    .select('id, user_id, public_key, sign_count, transports')
    .eq('kind', 'passkey')
    .eq('credential_id', parsed.data.response.id)
    .maybeSingle<{ id: string; user_id: string; public_key: string; sign_count: number; transports: string[] }>()
  if (!key) return Response.json({ error: NOT_KNOWN }, { status: 401 })

  const rp = relyingParty(request)
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: parsed.data.response.id,
        publicKey: isoBase64URL.toBuffer(key.public_key),
        counter: Number(key.sign_count) || 0,
        transports: key.transports,
      },
      requireUserVerification: true,
    })
  } catch {
    return Response.json({ error: 'That passkey could not be checked. Try again, or use your password.' }, { status: 401 })
  }
  if (!verification.verified) {
    return Response.json({ error: 'That passkey could not be checked. Try again, or use your password.' }, { status: 401 })
  }

  await service
    .from('sign_in_keys')
    .update({ sign_count: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq('id', key.id)

  const supabase = await createServerSupabase()
  return signInProven({ service, supabase, userId: key.user_id, address, request, method: 'passkey' })
}
