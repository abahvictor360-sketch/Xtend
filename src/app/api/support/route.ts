import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { respondToSupportThread } from '@/lib/support-assistant'
import { writtenText } from '@/lib/fields'
import { allowAttempt } from '@/lib/rate-limit'
import { HOUR_MS, SUPPORT_HELPER_REPLIES_PER_HOUR } from '@/lib/usage-limits'

export const maxDuration = 60

const schema = z.object({
  subject: writtenText(160, 0, 'the subject'),
  body: writtenText(4000, 2, 'your message'),
})

/** A field member opens a new support thread; the AI answers it at once. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Write your message first.' },
        { status: 400 },
      )
    }

    const supabase = await createServerSupabase()
    const { data: threadId, error } = await supabase.rpc('open_support_thread', {
      p_subject: parsed.data.subject || null,
      p_body: parsed.data.body,
    })
    if (error || !threadId) {
      return Response.json({ error: dbErrorMessage(error, 'Could not send your message.') }, { status: 400 })
    }

    // The message is saved either way; past the hourly allowance the office
    // answers it instead of the helper.
    const withinHourlyLimit = allowAttempt(
      `support-helper:${session.userId}`,
      SUPPORT_HELPER_REPLIES_PER_HOUR,
      HOUR_MS,
    )
    const result = await respondToSupportThread(threadId as string, { withinHourlyLimit })

    return Response.json(
      { thread_id: threadId, reply: result.reply, escalated: result.escalated },
      { status: 201 },
    )
  } catch (error) {
    return apiError(error)
  }
}
