import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Whether the signed-in person may take a stock count right now, and why.
 * Counts happen when a supervisor asks for one, or at the end of the month;
 * store_count_status() in Postgres is the authority on which.
 */
export type CountStatus =
  | {
      open: true
      reason: 'request'
      request_id: string
      due_date: string
      note: string | null
      requested_by: string
    }
  | { open: true; reason: 'month_end'; due_date: string }
  | { open: false; reason: 'none'; next_month_end: string }
  | { open: false; reason: 'not_allowed' }

export async function getCountStatus(supabase: SupabaseClient): Promise<CountStatus> {
  const { data, error } = await supabase.rpc('store_count_status')
  // Before migration 020 the function does not exist: counting stays closed.
  if (error || !data) return { open: false, reason: 'not_allowed' }
  return data as CountStatus
}
