import { apiError, requireApiSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { requireRecentAuth } from '@/lib/reconfirm'
import { APP_COOKIE, isAppRequest } from '@/lib/app-agent'
import { readCookie } from '@/lib/sign-in-finish'
import { auditKey, keyLabel, keysMissing, newAppSecret } from '@/lib/quick-sign-in'

/**
 * Turning on fingerprint sign-in in the app (0089). The phone gets a key id
 * and a long secret to keep behind the fingerprint; the server keeps only
 * the secret's hash. A new way into the account, so the password must have
 * been given in the last few minutes (a password sign-in counts).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    if (!isAppRequest(request.headers.get('user-agent'), readCookie(request, APP_COOKIE))) {
      return Response.json({ error: 'Fingerprint sign-in is set up in the Xtend app.' }, { status: 400 })
    }
    await requireRecentAuth(session)

    const { secret, hash } = newAppSecret()
    const label = keyLabel(request, 'Xtend app')
    const service = createAdminSupabase()
    const { data, error } = await service
      .from('sign_in_keys')
      .insert({ user_id: session.userId, kind: 'app', label, secret_hash: hash })
      .select('id')
      .single<{ id: string }>()
    if (keysMissing(error)) {
      return Response.json({ error: 'Fingerprint sign-in is not switched on yet. Ask an admin.' }, { status: 503 })
    }
    if (error || !data) return Response.json({ error: 'That did not work. Try again.' }, { status: 500 })

    await auditKey(service, session.userId, 'auth.key_add', { kind: 'app', label })
    return Response.json({ key_id: data.id, secret, label }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
