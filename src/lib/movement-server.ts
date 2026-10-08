import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Trail } from '@/lib/movement'
import { addDays } from '@/lib/utils'

/** The longest stretch the Movement page and its download cover at once. */
export const MAX_DAYS = 7

/** Every day from `from` to `until`, at most MAX_DAYS. */
export function daysBetween(from: string, until: string) {
  const days: string[] = []
  for (let d = from; d <= until && days.length < MAX_DAYS; d = addDays(d, 1)) days.push(d)
  return days
}

/**
 * One trail per day, from movement_trail() (028). RLS inside the function
 * keeps a supervisor to their own team.
 */
export async function fetchTrails(supabase: SupabaseClient, userId: string, days: string[]) {
  const results = await Promise.all(days.map((d) => supabase.rpc('movement_trail', { p_user: userId, p_date: d })))
  const failed = results.find((r) => r.error)?.error
  if (failed) {
    return {
      trails: [] as Trail[],
      error:
        failed.code === 'PGRST202' || failed.code === '42883'
          ? 'This needs the movement update (028) run in Supabase.'
          : failed.message,
    }
  }
  return { trails: results.map((r) => r.data as Trail), error: null }
}
