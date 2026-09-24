import { z } from 'zod'

/**
 * A change the assistant proposes: stores allocated to people, and people
 * put on a supervisor's team. The assistant only ever proposes; the plan is
 * shown to the person, and nothing is written until they press Apply.
 */
export interface PlanStoreChange {
  user_id: string
  user_name: string
  /** "add" keeps the stores they already have; "replace" makes these their only ones. */
  mode: 'add' | 'replace'
  outlet_ids: string[]
  outlet_names: string[]
  current_names: string[]
}

export interface PlanSupervisorChange {
  user_id: string
  user_name: string
  supervisor_id: string | null
  supervisor_name: string | null
  current_name: string | null
}

export interface ChangePlan {
  stores: PlanStoreChange[]
  supervisors: PlanSupervisorChange[]
  /** Lines from the file or text the assistant could not match to anybody. */
  unmatched: string[]
}

/** What Apply sends back: ids only, re-checked by the database on the way in. */
export const applyPlanSchema = z.object({
  stores: z
    .array(
      z.object({
        user_id: z.string().uuid(),
        mode: z.enum(['add', 'replace']),
        outlet_ids: z.array(z.string().uuid()).max(200),
      }),
    )
    .max(500),
  supervisors: z
    .array(z.object({ user_id: z.string().uuid(), supervisor_id: z.string().uuid().nullable() }))
    .max(500),
})

export type ApplyPlan = z.infer<typeof applyPlanSchema>

export interface ApplyResult {
  name: string
  ok: boolean
  detail: string
}
