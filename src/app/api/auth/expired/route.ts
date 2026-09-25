import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Ends a login that no longer counts (yesterday's, or one that has already
 * clocked out) and sends the person to sign in. A route handler rather than
 * a page, because only here can the session cookies be cleared.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const reason = url.searchParams.get('reason') === 'clocked-out' ? 'clocked-out' : 'new-day'
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL(`/login?reason=${reason}`, url.origin))
}
