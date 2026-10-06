import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { pushToUsers } from '@/lib/push-users'
import { longDate } from '@/lib/utils'

export const maxDuration = 60

const schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1, 'Pick at least one person').max(500),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).nullable().optional(),
})

/**
 * Asks people to take a store count by a date. Who may ask whom is decided
 * by request_store_count(); this route then tells the people on their phones.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 },
      )
    }
    const input = parsed.data

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('request_store_count', {
      p_user_ids: input.user_ids,
      p_due_date: input.due_date,
      p_note: input.note ?? null,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    const notified = await pushToUsers(input.user_ids, {
      title: 'Store count requested',
      body:
        `${session.profile.full_name} asked for a store count by ${longDate(input.due_date)}.` +
        (input.note ? ` ${input.note}` : ''),
      url: '/field/count',
    })

    return Response.json({ id: data, people: new Set(input.user_ids).size, notified }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
