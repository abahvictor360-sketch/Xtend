import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { assignSupervisor } from '@/lib/teams'
import { applyPlanSchema, type ApplyResult } from '@/lib/assistant-plan'

export const maxDuration = 60

/**
 * Applies a plan the assistant proposed, after the person pressed Apply.
 * Nothing here trusts the plan: store changes go through set_staff_outlets(),
 * which decides who may allocate whom, and reporting lines through
 * assignSupervisor(), which is admins only. Each person succeeds or fails on
 * their own, and the result says which.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const parsed = applyPlanSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'That plan is not valid.' }, { status: 400 })
    const plan = parsed.data

    const supabase = await createServerSupabase()
    const results: ApplyResult[] = []

    const ids = [...new Set([...plan.stores, ...plan.supervisors].map((r) => r.user_id))]
    const { data: people } = await supabase
      .from('staff_allocation')
      .select('user_id, staff_name, outlet_ids')
      .in('user_id', ids)
    const byId = new Map(
      ((people ?? []) as { user_id: string; staff_name: string; outlet_ids: string[] }[]).map((p) => [
        p.user_id,
        p,
      ]),
    )
    const nameOf = (id: string) => byId.get(id)?.staff_name ?? 'Unknown person'

    for (const change of plan.stores) {
      const current = byId.get(change.user_id)?.outlet_ids ?? []
      const wanted =
        change.mode === 'add' ? [...new Set([...current, ...change.outlet_ids])] : change.outlet_ids
      const { data, error } = await supabase.rpc('set_staff_outlets', {
        p_user_id: change.user_id,
        p_outlet_ids: wanted,
      })
      results.push(
        error
          ? { name: nameOf(change.user_id), ok: false, detail: error.message }
          : {
              name: nameOf(change.user_id),
              ok: true,
              detail: `${(data as string[] | null)?.length ?? wanted.length} store(s) allocated`,
            },
      )
    }

    // One call per supervisor, so a batch of forty is forty rows, not forty round trips.
    const bySupervisor = new Map<string | null, string[]>()
    for (const change of plan.supervisors) {
      const list = bySupervisor.get(change.supervisor_id) ?? []
      list.push(change.user_id)
      bySupervisor.set(change.supervisor_id, list)
    }
    for (const [supervisorId, userIds] of bySupervisor) {
      try {
        await assignSupervisor(session, userIds, supervisorId)
        for (const id of userIds) {
          results.push({
            name: nameOf(id),
            ok: true,
            detail: supervisorId ? 'supervisor set' : 'removed from their supervisor',
          })
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'could not be changed'
        for (const id of userIds) results.push({ name: nameOf(id), ok: false, detail })
      }
    }

    return Response.json({ results })
  } catch (error) {
    return apiError(error)
  }
}
