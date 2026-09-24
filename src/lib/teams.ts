import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { ApiError, type Session } from '@/lib/auth'
import { audit } from '@/lib/audit'

/**
 * Puts field staff on a supervisor's team, or takes them off it
 * (supervisorId null). Admins only: a reporting line is what gives a
 * supervisor sight of somebody. The database trigger still refuses anyone
 * who is not a supervisor or an admin as the supervisor.
 */
export async function assignSupervisor(
  session: Session,
  userIds: string[],
  supervisorId: string | null,
) {
  if (session.profile.role !== 'admin') {
    throw new ApiError("Only an admin can change who somebody reports to.", 403)
  }
  const ids = [...new Set(userIds)]
  if (!ids.length) return { updated: 0 }
  if (supervisorId && ids.includes(supervisorId)) {
    throw new ApiError('Somebody cannot supervise themselves.', 400)
  }

  const admin = createAdminSupabase()
  const { data: people, error: readError } = await admin
    .from('profiles')
    .select('id, role')
    .in('id', ids)
  if (readError) throw new ApiError(readError.message, 400)
  const found = people ?? []
  if (found.length !== ids.length) throw new ApiError('One of those people does not exist.', 400)
  if (found.some((p) => p.role !== 'merchandiser' && p.role !== 'marketer')) {
    throw new ApiError('Only merchandisers and marketers are put on a supervisor’s team.', 400)
  }

  const { error } = await admin.from('profiles').update({ supervisor_id: supervisorId }).in('id', ids)
  if (error) throw new ApiError(error.message, 400)

  const supabase = await createServerSupabase()
  await audit(supabase, 'staff.assign_supervisor', 'profiles', null, {
    user_ids: ids,
    supervisor_id: supervisorId,
    count: ids.length,
  })
  return { updated: ids.length }
}
