import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { auditContextHeader } from '@/lib/audit-context'

/**
 * Server side of test mode and the reset (0066). Admin checks happen in
 * the routes and again in the database functions.
 */

/**
 * Whether this is the admin's password, checked by signing in on a
 * throwaway client that keeps no session, so the admin's own sign-in in
 * the browser is untouched. The new session is ended straight away
 * (locally: a global sign-out would end the admin's other sessions too).
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
 * Service-role client that carries where the request came from, so the
 * audit row the database writes has the admin's location and device (049).
 */
export async function serviceClientWithContext(): Promise<SupabaseClient> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  const context = await auditContextHeader()
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(context ? { global: { headers: { 'x-xt-audit': context } } } : {}),
  })
}

/** Supabase removes at most 1,000 files per call. */
const BATCH = 1000

/**
 * Works through the files a reset queued (system_reset_files), deleting
 * them through the Storage API, until none are left or the deadline (a
 * Date.now() value) passes. Returns how many were removed and how many
 * are still waiting.
 */
export async function removeQueuedFiles(
  admin: SupabaseClient,
  deadline: number,
): Promise<{ removed: number; left: number; failed: boolean }> {
  let removed = 0
  let failed = false
  while (Date.now() < deadline) {
    const { data, error } = await admin.rpc('reset_files_next', { p_limit: BATCH })
    if (error) {
      console.error('reset files: listing failed', error.message)
      failed = true
      break
    }
    const rows = (data ?? []) as { bucket: string; name: string }[]
    if (rows.length === 0) break
    const byBucket = new Map<string, string[]>()
    for (const r of rows) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r.name])
    for (const [bucket, names] of byBucket) {
      // A file already gone (photos are purged after 14 days) is not an error.
      const { error: rmError } = await admin.storage.from(bucket).remove(names)
      if (rmError) {
        console.error('reset files: remove failed', bucket, rmError.message)
        failed = true
        break
      }
      const { error: doneError } = await admin.rpc('reset_files_done', { p_bucket: bucket, p_names: names })
      if (doneError) {
        console.error('reset files: could not mark done', doneError.message)
        failed = true
        break
      }
      removed += names.length
    }
    if (failed) break
  }
  const { count } = await admin.from('system_reset_files').select('name', { count: 'exact', head: true })
  return { removed, left: count ?? 0, failed }
}

/**
 * Only when the database could not delete sign-ins itself (auth_fallback):
 * removes every sign-in account that no longer has a profile, with the
 * Auth admin API. Admins all have profiles, so they are never touched.
 */
export async function removeOrphanSignIns(admin: SupabaseClient, deadline: number): Promise<number> {
  const { data: profiles, error } = await admin.from('profiles').select('id')
  if (error) throw new Error('Could not read the remaining accounts')
  const keep = new Set(((profiles ?? []) as { id: string }[]).map((p) => p.id))
  const orphans: string[] = []
  for (let page = 1; page < 100 && Date.now() < deadline; page++) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (listError) break
    for (const u of data.users) if (!keep.has(u.id)) orphans.push(u.id)
    if (data.users.length < 1000) break
  }
  let removed = 0
  for (const id of orphans) {
    if (Date.now() >= deadline) break
    const { error: delError } = await admin.auth.admin.deleteUser(id)
    if (!delError) removed++
  }
  return removed
}
