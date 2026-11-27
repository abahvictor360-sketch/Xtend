import { createServerSupabase } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { recordActivity } from '@/lib/activity-server'
import { sameSiteRedirect } from '@/lib/origin'
import { withRedirectOnError } from '@/lib/api-safe'

/**
 * Ends a login that no longer counts (yesterday's, or one that has already
 * clocked out) and sends the person to sign in. A route handler rather than
 * a page, because only here can the session cookies be cleared.
 *
 * The server decides whether the login has expired, not the link: anyone
 * can put this address in a page or a message, and opening it must not
 * sign out somebody whose login is still good.
 */
async function handleGet(request: Request) {
  const url = new URL(request.url)
  const session = await getSession()
  if (session && !session.relogin) return sameSiteRedirect('/')

  if (session) {
    await recordActivity(session.userId, 'sign_out', request.headers, { detail: { reason: session.relogin } })
    const supabase = await createServerSupabase()
    await supabase.auth.signOut()
  }
  // Already signed out: only the wording on the login page is at stake.
  const given = url.searchParams.get('reason')
  const asked = given === 'clocked-out' || given === 'office-time' || given === 'idle' ? given : 'new-day'
  const reason = session?.relogin ?? asked
  // Not a server redirect: the phone moves itself and stays on the address
  // it is on, whatever the proxy tells the server (a redirect built from
  // the server's own idea of its address opened Chrome on localhost).
  return sameSiteRedirect(`/login?reason=${reason}`)
}

// Never an HTML error page: logged, recorded, and answered (2026-11-27).
export const GET = withRedirectOnError(handleGet, '/login')
