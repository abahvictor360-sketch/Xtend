import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  /** True: must use the phone app. False: may use a browser again. */
  value: z.boolean(),
  /** Whom it applies to; everyone who works in the field by default. */
  role: z.enum(['merchandiser', 'marketer', 'all']).default('all'),
})

/**
 * Requires (or stops requiring) the phone app for every active merchandiser
 * and marketer at once (migration 0084). One person at a time is the Staff
 * page's own button (PATCH /api/admin/users/<id>). Admins only; audited.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    const { value, role } = parsed.data
    const roles = role === 'all' ? ['merchandiser', 'marketer'] : [role]

    const { data, error } = await createAdminSupabase()
      .from('profiles')
      .update({ app_only: value })
      .in('role', roles)
      .eq('is_active', true)
      .neq('app_only', value)
      .select('id')
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    const changed = data?.length ?? 0
    await audit(await createServerSupabase(), 'user.app_only_bulk', 'profiles', null, { value, role, changed })
    return Response.json({ ok: true, changed })
  } catch (error) {
    return apiError(error)
  }
}
