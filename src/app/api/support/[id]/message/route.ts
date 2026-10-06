import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { respondToSupportThread } from '@/lib/support-assistant'

export const maxDuration = 60

const schema = z.object({ body: z.string().trim().min(1).max(4000) })

/** A field member adds a message to their own thread; the AI replies again. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(FIELD_ROLES)
    const { id } = await params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Write your message first.' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    // The RPC checks the thread is the caller's; RLS blocks any other id.
    const { error } = await supabase.rpc('post_support_message', {
      p_thread: id,
      p_body: parsed.data.body,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    const result = await respondToSupportThread(id)
    return Response.json({ reply: result.reply, escalated: result.escalated }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
