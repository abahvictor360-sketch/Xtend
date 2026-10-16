import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { note } from '@/lib/fields'
import { notifyUsers } from '@/lib/notify'
import { LEAVE_KINDS, isLeaveKind, leaveRangeText } from '@/lib/schedule'

const schema = z.object({
  decision: z.enum(['approve', 'reject'], { message: 'Approve or reject the request' }),
  note: note(500),
})

/**
 * The person's supervisor or an admin approves or rejects a leave request.
 * decide_leave() (migration 059) checks who may, refuses anyone deciding
 * their own, and writes the audit row in the same transaction. The person
 * is then told.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: 'That request was not found' }, { status: 404 })
    }
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Check the note' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('decide_leave', {
      p_id: id,
      p_approve: parsed.data.decision === 'approve',
      p_note: parsed.data.note,
    })
    if (error || !data) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    const result = data as { user_id: string; status: string; kind: string; from_date: string; to_date: string; note: string }
    const what = isLeaveKind(result.kind) ? LEAVE_KINDS[result.kind].toLowerCase() : 'leave'
    const approved = result.status === 'approved'
    await notifyUsers([result.user_id], {
      title: approved ? 'Leave approved' : 'Leave not approved',
      body:
        `Your ${what} for ${leaveRangeText(result.from_date, result.to_date)} was ${approved ? 'approved' : 'not approved'}.` +
        (result.note ? ` ${result.note}` : ''),
      url: '/field/leave',
      senderId: session.userId,
      detail: { kind: 'leave_decision', leave_id: id },
    })

    return Response.json({ ok: true, status: result.status })
  } catch (error) {
    return apiError(error)
  }
}
