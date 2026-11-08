import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { respondToSupportThread } from '@/lib/support-assistant'
import { writtenText } from '@/lib/fields'
import { allowAttempt } from '@/lib/rate-limit'
import { HOUR_MS, SUPPORT_HELPER_REPLIES_PER_HOUR } from '@/lib/usage-limits'

export const maxDuration = 60

const schema = z.object({ body: writtenText(4000, 2, 'your message') })

/** A field member adds a message to their own thread; the AI replies again. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const { id } = await params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Write your message first.' },
        { status: 400 },
      )
    }

    const supabase = await createServerSupabase()
    // The RPC checks the thread is the caller's; RLS blocks any other id.
    const { error } = await supabase.rpc('post_support_message', {
      p_thread: id,
      p_body: parsed.data.body,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    // The message is saved either way; past the hourly allowance the office
    // answers it instead of the helper.
    const withinHourlyLimit = await allowAttempt(
      `support-helper:${session.userId}`,
      SUPPORT_HELPER_REPLIES_PER_HOUR,
      HOUR_MS,
    )
    const result = await respondToSupportThread(id, { withinHourlyLimit })
    return Response.json({ reply: result.reply, escalated: result.escalated }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
