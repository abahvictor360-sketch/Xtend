import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'
import { auditContext } from '@/lib/audit-context'

const schema = z.object({ event: z.enum(['enroll', 'verify']) })

/**
 * After the browser finished a two-step step with Supabase (0080): the
 * server checks this session really is two-step now, counts the fresh code
 * as a recent confirmation for risky actions, and audits a new setup.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(undefined, { allowDuringPasswordChange: true })
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Unknown step.' }, { status: 400 })
    if (!session.mfa.enrolled || session.mfa.step) {
      return Response.json({ error: 'Two-step sign-in is not finished.' }, { status: 409 })
    }
    const admin = createAdminSupabase()
    await admin.rpc('confirm_recent_auth', { p_user: session.userId })
    if (parsed.data.event === 'enroll') {
      await admin.from('audit_log').insert({
        actor_id: session.userId,
        action: 'auth.mfa_enroll',
        target_table: 'profiles',
        target_id: session.userId,
        meta: { _context: await auditContext() },
      })
    }
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
