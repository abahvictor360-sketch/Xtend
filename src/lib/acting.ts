import 'server-only'
import { cookies } from 'next/headers'
import type { Session } from '@/lib/auth'

/**
 * "View as": an admin can use the field app as a merchandiser or a marketer,
 * to test-run clock-in, store visits and reports in different places. The
 * admin already has every field capability in the database (can_visit_stores,
 * can_file_report are true for admin), so this only tailors the experience:
 * a merchandiser view hides store visits and the report; a marketer view
 * shows both. The choice is a cookie, honoured only when the signed-in person
 * really is an admin, so it can never widen a field member's own access.
 */
export const ACTING_COOKIE = 'xtend_acting'

export type ActingRole = 'merchandiser' | 'marketer'

/** The field role an admin is viewing the app as, or null (admins only). */
export async function getActingRole(session: Session): Promise<ActingRole | null> {
  if (session.profile.role !== 'admin') return null
  const value = (await cookies()).get(ACTING_COOKIE)?.value
  return value === 'merchandiser' || value === 'marketer' ? value : null
}
