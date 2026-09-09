import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Every admin mutation leaves a row. actor_id is taken from the session by
 * the database function, never from the request body.
 */
export async function audit(
  supabase: SupabaseClient,
  action: string,
  target_table: string | null,
  target_id: string | null,
  meta: Record<string, unknown> = {},
) {
  const { error } = await supabase.rpc('write_audit', {
    p_action: action,
    p_target_table: target_table,
    p_target_id: target_id,
    p_meta: meta,
  })
  if (error) console.error('audit failed', action, error.message)
}
