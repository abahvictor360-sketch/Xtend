import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS, so it is only ever constructed inside a
 * route handler that has already verified the caller is an admin.
 */
export function createAdminSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
