import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { respondToSupportThread } from '@/lib/support-assistant'

export const maxDuration = 60

const schema = z.object({
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(4000),
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
      p_subject: parsed.data.subject ?? null,
      p_body: parsed.data.body,
    })
    if (error || !threadId) {
      return Response.json({ error: dbErrorMessage(error, 'Could not send your message.') }, { status: 400 })
    }

    void session
    const result = await respondToSupportThread(threadId as string)

    return Response.json(
      { thread_id: threadId, reply: result.reply, escalated: result.escalated },
      { status: 201 },
    )
  } catch (error) {
    return apiError(error)
  }
}
