import { apiError, requireApiSession } from '@/lib/auth'
import { actionSchema, type ActionResult } from '@/lib/assistant-action-types'
import { POST as sendNotification } from '@/app/api/admin/notifications/route'
import { POST as requestCount } from '@/app/api/admin/count-requests/route'
import { POST as closeCount } from '@/app/api/admin/count-requests/[id]/close/route'
import { POST as checkPhone } from '@/app/api/admin/phone-check/route'
import { POST as reviewFlag } from '@/app/api/admin/integrity/[id]/review/route'
import { POST as setTarget } from '@/app/api/admin/metrics/targets/route'
import { POST as setXmStore } from '@/app/api/admin/metrics/stores/route'
import { PATCH as updateOutlet } from '@/app/api/admin/outlets/[id]/route'
import { PATCH as updateUser } from '@/app/api/admin/users/[id]/route'
import { POST as setSchedule } from '@/app/api/admin/schedules/route'
import { POST as officeCount } from '@/app/api/admin/metrics/count/route'
import { POST as logSupply } from '@/app/api/admin/metrics/supplies/route'

export const maxDuration = 60

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

/**
 * Carries out an action Ask Xtend proposed, after the person pressed its
 * button. Each one goes through the very route the dashboard's own button
 * uses, in this same request (so with this person's session): the same
 * checks on who may do what, the same pushes, the same audit rows. Nothing
 * here decides a permission.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = actionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'That action is not valid.' }, { status: 400 })
    const action = parsed.data

    const call = async (handler: Handler, path: string, body: unknown, params: Record<string, string> = {}, method = 'POST') => {
      const res = await handler(
        new Request(new URL(path, request.url), {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve(params) },
      )
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: res.ok, json, error: typeof json.error === 'string' ? json.error : `Failed (${res.status})` }
    }

    let result: ActionResult
    switch (action.kind) {
      case 'notify': {
        const r = await call(sendNotification as Handler, '/api/admin/notifications', { ...action.payload, preview: false })
        result = r.ok
          ? { ok: true, detail: `Sent to ${r.json.recipients} (${r.json.delivered} delivered${r.json.failed ? `, ${r.json.failed} failed` : ''}).` }
          : { ok: false, detail: r.error }
        break
      }
      case 'count_request': {
        const r = await call(requestCount as Handler, '/api/admin/count-requests', action.payload)
        result = r.ok
          ? { ok: true, detail: `Requested from ${r.json.people}; ${r.json.notified ?? 0} told on their phone.` }
          : { ok: false, detail: r.error }
        break
      }
      case 'close_count_request': {
        const id = action.payload.request_id
        const r = await call(closeCount as Handler, `/api/admin/count-requests/${id}/close`, {}, { id })
        result = r.ok ? { ok: true, detail: 'Closed.' } : { ok: false, detail: r.error }
        break
      }
      case 'phone_check': {
        const r = await call(checkPhone as Handler, '/api/admin/phone-check', action.payload)
        result = r.ok
          ? { ok: true, detail: 'Sent. Their phone answers within a minute if it is on; see Check an excuse for the answer.' }
          : { ok: false, detail: r.error }
        break
      }
      case 'review_flags': {
        let done = 0
        let firstError: string | null = null
        for (const id of action.payload.flag_ids) {
          const r = await call(reviewFlag as Handler, `/api/admin/integrity/${id}/review`, { note: action.payload.note }, { id })
          if (r.ok) done++
          else firstError ??= r.error
        }
        result = {
          ok: done > 0,
          detail: `${done} of ${action.payload.flag_ids.length} marked reviewed${firstError ? `. ${firstError}` : '.'}`,
        }
        break
      }
      case 'sales_target': {
        const r = await call(setTarget as Handler, '/api/admin/metrics/targets', action.payload)
        result = r.ok ? { ok: true, detail: 'Target set.' } : { ok: false, detail: r.error }
        break
      }
      case 'xm_store': {
        const r = await call(setXmStore as Handler, '/api/admin/metrics/stores', action.payload)
        result = r.ok ? { ok: true, detail: action.payload.active ? 'Added to X Metrics.' : 'Removed from X Metrics.' } : { ok: false, detail: r.error }
        break
      }
      case 'outlet_hours': {
        const id = action.payload.outlet_id
        const r = await call(
          updateOutlet as Handler,
          `/api/admin/outlets/${id}`,
          { shift_start: action.payload.shift_start, shift_end: action.payload.shift_end },
          { id },
          'PATCH',
        )
        result = r.ok
          ? { ok: true, detail: `Clock-in ${action.payload.shift_start}, clock-out ${action.payload.shift_end}.` }
          : { ok: false, detail: r.error }
        break
      }
      case 'work_pattern': {
        const r = await call(setSchedule as Handler, '/api/admin/schedules', {
          user_ids: action.payload.user_ids,
          days: action.payload.days,
        })
        const n = (r.json.updated as number | undefined) ?? action.payload.user_ids.length
        result = r.ok
          ? { ok: true, detail: `Schedule set for ${n} ${n === 1 ? 'person' : 'people'}.` }
          : { ok: false, detail: r.error }
        break
      }
      case 'xm_count': {
        const r = await call(officeCount as Handler, '/api/admin/metrics/count', action.payload)
        const n = action.payload.lines.length
        result = r.ok
          ? { ok: true, detail: `Count recorded: ${n} ${n === 1 ? 'product' : 'products'}.` }
          : { ok: false, detail: r.error }
        break
      }
      case 'xm_supply': {
        let done = 0
        let firstError: string | null = null
        for (const line of action.payload.lines) {
          const r = await call(logSupply as Handler, '/api/admin/metrics/supplies', {
            outlet_id: action.payload.outlet_id,
            product_id: line.product_id,
            quantity: line.quantity,
            batch: line.batch,
            expiry_date: line.expiry_date,
            supplied_on: action.payload.supplied_on,
          })
          if (r.ok) done++
          else firstError ??= r.error
        }
        result = {
          ok: done > 0,
          detail: `${done} of ${action.payload.lines.length} deliveries logged${firstError ? `. ${firstError}` : '.'}`,
        }
        break
      }
      case 'deactivate': {
        const id = action.payload.user_id
        const r = await call(updateUser as Handler, `/api/admin/users/${id}`, { is_active: false }, { id }, 'PATCH')
        result = r.ok ? { ok: true, detail: 'Deactivated.' } : { ok: false, detail: r.error }
        break
      }
    }
    return Response.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    return apiError(error)
  }
}
