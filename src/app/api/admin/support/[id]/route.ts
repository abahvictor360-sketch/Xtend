import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notifyUsers } from '@/lib/notify'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('assign'), user_id: z.string().uuid().nullable() }),
])

/**
 * Close, reopen or hand a support thread to someone in the office. The
 * database functions decide who may (an admin, or the member's supervisor)
 * and who a thread can go to.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: 'Which thread?' }, { status: 400 })
    }
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'What should happen to the thread?' }, { status: 400 })
    const input = parsed.data
    const supabase = await createServerSupabase()

    if (input.action === 'close') {
      const { error } = await supabase.rpc('resolve_support_thread', { p_thread: id })
      if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
      await audit(supabase, 'support.close', 'support_threads', id)
      return Response.json({ ok: true })
    }

    if (input.action === 'reopen') {
      const { error } = await supabase.rpc('reopen_support_thread', { p_thread: id })
      if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
      await audit(supabase, 'support.reopen', 'support_threads', id)
      return Response.json({ ok: true })
    }

    const { error } = await supabase.rpc('assign_support_thread', { p_thread: id, p_assignee: input.user_id })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'support.assign', 'support_threads', id, { assigned_to: input.user_id })

    // Tell the person it was given to, unless they took it themselves.
    if (input.user_id && input.user_id !== session.userId) {
      const { data: thread } = await supabase
        .from('support_inbox')
        .select('subject, staff_name')
        .eq('id', id)
        .maybeSingle<{ subject: string; staff_name: string }>()
      if (thread) {
        await notifyUsers([input.user_id], {
          title: 'A support issue was passed to you',
          body: `${thread.staff_name}: ${thread.subject}. ${session.profile.full_name} asked you to answer it.`,
          url: `/admin/support?thread=${id}`,
          senderId: session.userId,
          detail: { kind: 'support_assigned', thread_id: id },
        })
      }
    }
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
