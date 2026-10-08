import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { auditContextHeader } from '@/lib/audit-context'

/** Request-scoped client that carries the caller's session, so RLS applies. */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  // Where and on what device the request came from, for audit rows written
  // inside database functions (see 0049).
  const context = await auditContextHeader()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(context ? { global: { headers: { 'x-xt-audit': context } } } : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component. The middleware
            // (src/middleware.ts) refreshes the session cookie instead.
          }
        },
      },
    },
  )
}
