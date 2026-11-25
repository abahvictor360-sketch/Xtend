import { createServerSupabase } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { recordActivity } from '@/lib/activity-server'
import { sameSiteRedirect } from '@/lib/origin'

/**
 * A fake location paused this account (0108): sign them out, everywhere
 * they are, and say on the login page to contact their supervisor or admin.
 * Only a paused account is signed out here; opening this address otherwise
 * changes nothing.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (session && !session.profile.paused_at) return sameSiteRedirect('/')
  if (session) {
    await recordActivity(session.userId, 'sign_out', request.headers, { detail: { reason: 'paused' } })
    const supabase = await createServerSupabase()
    await supabase.auth.signOut()
  }
  return sameSiteRedirect('/login?reason=paused')
}
