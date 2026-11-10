import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'
import { auditContext } from '@/lib/audit-context'
import { allowAttempt } from '@/lib/rate-limit'
import { credentialsAreRight } from '@/lib/password-check'

const schema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().trim().max(6).optional().nullable(),
})

/**
 * "Confirm it is you" before a risky action (0080): the password, and the
 * code for an account with two-step sign-in, checked afresh on the server.
 * A success counts for 10 minutes (requireRecentAuth) and is audited.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    if (!(await allowAttempt(`reconfirm:${session.userId}`, 10, 15 * 60_000))) {
      return Response.json({ error: 'Too many tries. Wait 15 minutes, then try again.' }, { status: 429 })
    }
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || !session.email) {
      return Response.json({ error: 'Enter your password.' }, { status: 400 })
    }
    const result = await credentialsAreRight(session.email, parsed.data.password, parsed.data.code ?? null)
    if (result === 'wrong') return Response.json({ error: 'That password is not right.' }, { status: 401 })
    if (result === 'code') {
      return Response.json(
        { error: 'Enter the 6-digit code from your authenticator app.', code: 'code_needed' },
        { status: 401 },
      )
    }
    const admin = createAdminSupabase()
    await admin.rpc('confirm_recent_auth', { p_user: session.userId })
    await admin.from('audit_log').insert({
      actor_id: session.userId,
      action: 'auth.reconfirm',
      target_table: 'profiles',
      target_id: session.userId,
      meta: { _context: await auditContext() },
    })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
