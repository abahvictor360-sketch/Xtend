import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeSchedule, type LeaveRow, type OverrideRow, type PatternRow, type ScheduleBook } from '@/lib/schedule'

const PAGE = 1000
const MAX_ROWS = 20_000

/** Every row of a query, a page at a time (PostgREST stops at 1000). */
async function allRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; start < MAX_ROWS; start += PAGE) {
    const { data, error } = await build(start, start + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/**
 * Weekly patterns, date changes and approved leave between two days, for
 * everyone the caller may see. Read through the caller's own client, so a
 * supervisor gets their team only (RLS, migration 059).
 */
export async function loadSchedule(
  supabase: SupabaseClient,
  from: string,
  to: string,
  userIds?: string[] | null,
): Promise<ScheduleBook> {
  const only = userIds && userIds.length > 0 && userIds.length <= 200 ? userIds : null
  const [patterns, overrides, leave] = await Promise.all([
    allRows<PatternRow>((a, b) => {
      let q = supabase.from('work_patterns').select('user_id, days').order('user_id').range(a, b)
      if (only) q = q.in('user_id', only)
      return q
    }),
    allRows<OverrideRow>((a, b) => {
      let q = supabase
        .from('schedule_overrides')
        .select('id, user_id, day, working, note')
        .gte('day', from)
        .lte('day', to)
        .order('id')
        .range(a, b)
      if (only) q = q.in('user_id', only)
      return q
    }),
    allRows<Pick<LeaveRow, 'user_id' | 'from_date' | 'to_date' | 'status'>>((a, b) => {
      let q = supabase
        .from('leave_requests')
        .select('user_id, from_date, to_date, status')
        .eq('status', 'approved')
        .lte('from_date', to)
        .gte('to_date', from)
        .order('id')
        .range(a, b)
      if (only) q = q.in('user_id', only)
      return q
    }),
  ])
  return makeSchedule(patterns, overrides, leave)
}

/** The schedule, or everyone on the usual week if it cannot be read. */
export async function loadScheduleSafe(
  supabase: SupabaseClient,
  from: string,
  to: string,
  userIds?: string[] | null,
): Promise<ScheduleBook> {
  try {
    return await loadSchedule(supabase, from, to, userIds)
  } catch (error) {
    console.error('schedule could not be read', error)
    return makeSchedule()
  }
}
