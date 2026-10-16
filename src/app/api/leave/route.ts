import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { writtenText } from '@/lib/fields'
import { notifyWatchers } from '@/lib/notify'
import { LEAVE_KINDS, LEAVE_LIMITS, leaveRangeText } from '@/lib/schedule'

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')

const schema = z.object({
  kind: z.enum(['annual', 'sick', 'casual', 'other'], { message: 'Pick the type of leave' }),
  from: DAY,
  to: DAY,
  reason: writtenText(LEAVE_LIMITS.reasonMax, LEAVE_LIMITS.reasonMin, 'the reason'),
})

/**
 * A member of staff asks for leave. apply_leave() (migration 059) checks
 * the dates, the reason and overlaps; the supervisor and admins are told.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Check the form' }, { status: 400 })
    }
    const { kind, from, to, reason } = parsed.data

    const supabase = await createServerSupabase()
    const { data: id, error } = await supabase.rpc('apply_leave', {
      p_kind: kind,
      p_from: from,
      p_to: to,
      p_reason: reason,
    })
    if (error || !id) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    await notifyWatchers({
      subjectId: session.userId,
      title: `${session.profile.full_name} asked for leave`,
      body: `${LEAVE_KINDS[kind]}: ${leaveRangeText(from, to)}. ${reason}`,
      url: '/admin/leave?status=pending',
      detail: { kind: 'leave_request', leave_id: id },
    })

    return Response.json({ id }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
