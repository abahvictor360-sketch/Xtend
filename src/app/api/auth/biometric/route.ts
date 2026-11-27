import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { allowAttempt, clientAddress } from '@/lib/rate-limit'
import { newAppSecret, secretMatches } from '@/lib/quick-sign-in'
import { signInProven } from '@/lib/sign-in-finish'
import { withErrors } from '@/lib/api-safe'

const schema = z.object({
  key_id: z.string().guid(),
  secret: z.string().min(20).max(200),
})

const TURNED_OFF =
  'Fingerprint sign-in was turned off on this phone. Sign in with your password, then turn it on again.'

/**
 * Signing in with the fingerprint in the app (0089): the phone opened its
 * stored secret with the fingerprint and sends it here. A match signs the
 * person in under the same rules as a password, and the answer carries a
 * new secret for the phone to keep: each one works once. A wrong secret
 * for a real key (a copied or old one) removes the key.
 */
async function handlePost(request: Request) {
  const address = clientAddress(request)
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: TURNED_OFF, code: 'key_gone' }, { status: 400 })
  const { key_id, secret } = parsed.data

  const tooMany = Response.json({ error: 'Too many attempts. Wait 15 minutes, then try again.' }, { status: 429 })
  if (!(await allowAttempt(`fingerprint:ip:${address}`, 30, 15 * 60 * 1000))) return tooMany
  if (!(await allowAttempt(`fingerprint:key:${key_id}`, 10, 15 * 60 * 1000))) return tooMany

  const service = createAdminSupabase()
  const { data: key } = await service
    .from('sign_in_keys')
    .select('id, user_id, secret_hash')
    .eq('id', key_id)
    .eq('kind', 'app')
    .maybeSingle<{ id: string; user_id: string; secret_hash: string }>()
  if (!key) return Response.json({ error: TURNED_OFF, code: 'key_gone' }, { status: 401 })

  if (!secretMatches(secret, key.secret_hash)) {
    // An old or copied secret: this key cannot be trusted any more.
    await service.from('sign_in_keys').delete().eq('id', key.id)
    return Response.json({ error: TURNED_OFF, code: 'key_gone' }, { status: 401 })
  }

  const next = newAppSecret()
  const supabase = await createServerSupabase()
  const answer = await signInProven({
    service,
    supabase,
    userId: key.user_id,
    address,
    request,
    method: 'fingerprint',
    extra: { secret: next.secret },
  })
  // Signed in: the old secret stops working, the new one takes its place.
  if (answer.ok) {
    await service
      .from('sign_in_keys')
      .update({ secret_hash: next.hash, last_used_at: new Date().toISOString() })
      .eq('id', key.id)
  }
  return answer
}

// Never an HTML error page: logged, recorded, and answered (2026-11-27).
export const POST = withErrors(handlePost)
