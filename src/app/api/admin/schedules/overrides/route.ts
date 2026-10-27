import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { note } from '@/lib/fields'

const schema = z.object({
  user_id: z.string().uuid('Pick a person'),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  working: z.boolean(),
  note: note(300),
})

/**
 * One date made an extra day in or an extra day off for someone
 * (set_schedule_override, migration 059; audited there).
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor', 'hr'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Check the date' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('set_schedule_override', {
      p_user: parsed.data.user_id,
      p_day: parsed.data.day,
      p_working: parsed.data.working,
      p_note: parsed.data.note,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ id: data as string }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
