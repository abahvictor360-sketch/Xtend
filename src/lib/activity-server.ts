import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { requestIp } from '@/lib/client-ip'
import { parseUserAgent } from '@/lib/audit-context'
import { deviceLabel } from '@/lib/audit-log'
import { type ActivityFilter, type ActivityRow, filterKinds } from '@/lib/activity-log'

export type RecordedKind = 'sign_in' | 'sign_out' | 'app_open' | 'password_changed' | 'photo_changed'

/**
 * Records something a person did (migration 062) with the address and the
 * device the request came from. The database decides whether an app open
 * is new enough to keep. Never throws: a missed row must not stop anyone
 * signing in, out or changing a password.
 */
export async function recordActivity(
  userId: string,
  kind: RecordedKind,
  headers: Headers,
  extra: { platform?: 'web' | 'android' | 'ios' | null; appBuild?: number | null; detail?: Record<string, unknown> } = {},
) {
  try {
    const ua = headers.get('user-agent')?.slice(0, 500) ?? null
    const { error } = await createAdminSupabase().rpc('record_activity', {
      p_user: userId,
      p_kind: kind,
      p_ip: requestIp(headers),
      p_platform: extra.platform ?? null,
      p_app_build: extra.appBuild ?? null,
      p_user_agent: ua,
      p_device: parseUserAgent(ua),
      p_detail: extra.detail ?? {},
    })
    if (error) console.error('activity not recorded', kind, error.message)
  } catch (error) {
    console.error('activity not recorded', kind, error instanceof Error ? error.message : error)
  }
}

/** The filtered activity, through the caller's own client (admins only, in the database). */
export async function fetchActivity(supabase: SupabaseClient, f: ActivityFilter, limit = 2000) {
  const { data, error } = await supabase.rpc('activity_feed', {
    p_from: f.from,
    p_to: f.to,
    p_user: f.person,
    p_kinds: filterKinds(f.group),
    p_limit: limit + 1,
  })
  if (error) throw new Error(missingMigration(error.message) ? MISSING : error.message)
  // Clock-ins and visits keep only the browser string; name the device from it.
  const rows = ((data ?? []) as ActivityRow[]).map((r) =>
    r.device || !r.user_agent ? r : { ...r, device: deviceLabel(parseUserAgent(r.user_agent)) },
  )
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

export const MISSING = 'The activity log needs migration 062 (supabase/migrations/0062_user_activity.sql). Run it in Supabase, then reload.'

function missingMigration(message: string) {
  return /activity_feed|user_activity|schema cache|does not exist/i.test(message)
}
