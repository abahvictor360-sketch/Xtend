import { z } from 'zod'
import { zText } from '@/lib/validation'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'

export const maxDuration = 60

const schema = z.object({
  body: zText({ max: 4000, what: 'reply' }),
  resolve: z.boolean().default(false),
})

/** An admin or the member's supervisor replies on a thread, and the member
 *  hears about it in their inbox. Optionally resolves the thread. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const { id } = await params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Write a reply first.' },
        { status: 400 },
      )
    }

    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('post_support_message', {
      p_thread: id,
      p_body: parsed.data.body,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    if (parsed.data.resolve) {
      await supabase.rpc('resolve_support_thread', { p_thread: id })
    }

    // Tell the member, using the service role to read the thread owner.
    const admin = createAdminSupabase()
    const { data: thread } = await admin
      .from('support_threads')
      .select('user_id, subject')
      .eq('id', id)
      .maybeSingle<{ user_id: string; subject: string }>()

    if (thread) {
      await notifyUsers([thread.user_id], {
        title: 'Reply from the office',
        body: `${thread.subject}: ${parsed.data.body.slice(0, 200)}`,
        url: '/field/support',
        senderId: session.userId,
        detail: { kind: 'support_reply', thread_id: id },
      })
    }

    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
