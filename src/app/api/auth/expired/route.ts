import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

/**
 * Ends a login that no longer counts (yesterday's, or one that has already
 * clocked out) and sends the person to sign in. A route handler rather than
 * a page, because only here can the session cookies be cleared.
 *
 * The server decides whether the login has expired, not the link: anyone
 * can put this address in a page or a message, and opening it must not
 * sign out somebody whose login is still good.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const session = await getSession()
  if (session && !session.relogin) return NextResponse.redirect(new URL('/', url.origin))

  if (session) {
    const supabase = await createServerSupabase()
    await supabase.auth.signOut()
  }
  // Already signed out: only the wording on the login page is at stake.
  const asked = url.searchParams.get('reason') === 'clocked-out' ? 'clocked-out' : 'new-day'
  const reason = session?.relogin ?? asked
  return NextResponse.redirect(new URL(`/login?reason=${reason}`, url.origin))
}
