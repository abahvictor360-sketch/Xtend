import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Whether this is the password for that email, checked by signing in on a
 * throwaway client that keeps no session, so the person's own sign-in is
 * untouched. The new session is ended straight away (locally: a global
 * sign-out would end their other sessions too).
 */
export async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) return false
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
  return true
}

/**
 * An address no account can have (`.invalid` is reserved). Signing in with
 * it costs the same round trip as a real attempt, so a sign-in for a phone
 * number nobody has takes as long as one with a wrong password.
 */
export const NO_SUCH_ACCOUNT = 'no-such-account@xtend.invalid'
