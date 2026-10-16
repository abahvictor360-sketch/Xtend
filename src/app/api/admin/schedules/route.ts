import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

const schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1, 'Pick at least one person').max(500, 'Set at most 500 people at a time'),
  // Days of the week worked, 0 = Sunday … 6 = Saturday. Null: back to Monday to Saturday.
  days: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
})

/**
 * Sets one weekly pattern for one or several people (set_work_pattern,
 * migration 059). The database checks every person is on the caller's team
 * and writes one audit row per person.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Check the schedule' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('set_work_pattern', {
      p_users: parsed.data.user_ids,
      p_days: parsed.data.days,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ updated: data as number })
  } catch (error) {
    return apiError(error)
  }
}
