import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { notifyUsers } from '@/lib/notify'
import { formatLagos } from '@/lib/utils'
import { CORRECTION_ACTIONS, correctionNotice, type CorrectionAction } from '@/lib/field-corrections'

const schema = z.object({
  user_id: z.string().guid(),
  action: z.enum(CORRECTION_ACTIONS),
  reason: z.string().trim().min(3, 'Say why, in a few words.').max(500),
  outlet_id: z.string().guid().nullable().optional(),
  /** A clock-in or clock-out time today (ISO); left out: now. */
  at: z.string().datetime({ offset: true }).nullable().optional(),
  visit_id: z.string().guid().nullable().optional(),
})

/**
 * The office fixes someone's day (0090): records a clock-in, clock-out,
 * store check-in or check-out for them, asks them to do one again, or
 * undoes a clock-out made by mistake (0093).
 * Postgres decides who may (an admin, HR, or their supervisor, for active
 * field staff) and keeps every correction; this audits it and tells them.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor', 'hr'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 })
    }
    const input = parsed.data
    const action = input.action as CorrectionAction
    const supabase = await createServerSupabase()

    let result: { data: unknown; error: { message: string; code?: string } | null }
    if (action === 'office_clock_in' || action === 'office_clock_out') {
      if (!input.outlet_id) return Response.json({ error: 'Pick the store.' }, { status: 400 })
      result = await supabase.rpc('office_record_clock', {
        p_user: input.user_id,
        p_type: action === 'office_clock_in' ? 'opening' : 'closing',
        p_outlet: input.outlet_id,
        p_at: input.at ?? null,
        p_reason: input.reason,
      })
    } else if (action === 'office_check_in' || action === 'office_check_out') {
      if (action === 'office_check_in' && !input.outlet_id) {
        return Response.json({ error: 'Pick the store.' }, { status: 400 })
      }
      result = await supabase.rpc('office_record_visit', {
        p_user: input.user_id,
        p_action: action === 'office_check_in' ? 'check_in' : 'check_out',
        p_outlet: input.outlet_id ?? null,
        p_reason: input.reason,
      })
    } else if (action === 'reset_clock_out') {
      // A clock-out made by mistake (0093): back on shift.
      result = await supabase.rpc('office_reset_clock_out', { p_user: input.user_id, p_reason: input.reason })
    } else {
      if ((action === 'redo_check_in' || action === 'redo_check_out') && !input.visit_id) {
        return Response.json({ error: 'Pick the store visit.' }, { status: 400 })
      }
      result = await supabase.rpc('office_request_redo', {
        p_user: input.user_id,
        p_action: action,
        p_reason: input.reason,
        p_visit: input.visit_id ?? null,
      })
    }
    if (result.error) {
      const missing = result.error.code === 'PGRST202' || result.error.code === '42883'
      return Response.json(
        {
          error: missing
            ? `This needs migration ${action === 'reset_clock_out' ? '0093' : '0090'}. Ask an admin to run it.`
            : dbErrorMessage(result.error),
        },
        { status: missing ? 503 : 400 },
      )
    }

    await audit(supabase, `field.${action}`, 'profiles', input.user_id, {
      reason: input.reason,
      outlet_id: input.outlet_id ?? null,
      at: input.at ?? null,
      visit_id: input.visit_id ?? null,
      record_id: typeof result.data === 'string' ? result.data : null,
    })

    // Tell them what the office did, or what to do now.
    const { data: store } = input.outlet_id
      ? await createAdminSupabase().from('outlets').select('name').eq('id', input.outlet_id).maybeSingle<{ name: string }>()
      : { data: null }
    const notice = correctionNotice(action, {
      by: session.profile.full_name,
      store: store?.name ?? null,
      time: formatLagos(input.at ?? new Date().toISOString(), false),
      reason: input.reason,
    })
    await notifyUsers([input.user_id], {
      title: notice.title,
      body: notice.body,
      url: '/field',
      senderId: session.userId,
      detail: { kind: 'field_correction', action },
    })

    return Response.json({ ok: true, id: result.data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
