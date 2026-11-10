import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { ApiError, type Session } from '@/lib/auth'
import { RECONFIRM_MINUTES } from '@/lib/zero-trust'

/** The answer code the dashboard knows to open the "confirm it is you" box for. */
export const RECONFIRM_CODE = 'reconfirm'

/**
 * Zero trust for risky actions (0080): the password (and code) must have
 * been confirmed in the last RECONFIRM_MINUTES, whatever the session says.
 * Checked on the server; the dashboard asks, confirms through
 * /api/auth/reconfirm and sends the action again. Before 0080 is run the
 * check is skipped rather than locking everyone out of these actions.
 */
export async function requireRecentAuth(session: Session) {
  const { data, error } = await createAdminSupabase().rpc('recent_auth_ok', {
    p_user: session.userId,
    p_minutes: RECONFIRM_MINUTES,
  })
  if (error) {
    const missing = error.code === 'PGRST202' || error.code === '42883'
    if (missing) return
    throw new ApiError('That could not be checked. Try again.', 503)
  }
  if (data !== true) {
    throw new ApiError('Confirm it is you: enter your password again to do this.', 403, RECONFIRM_CODE)
  }
}
