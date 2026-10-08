import { z } from 'zod'

/**
 * Things Ask Xtend can do on the dashboard when asked: send a notification,
 * ask for a stock count, check a phone, mark flags reviewed, and so on. The
 * assistant only ever proposes one; the person sees what it will do and
 * presses Apply, and the change then goes through the same route (and the
 * same permission checks, pushes and audit rows) as the button on the page.
 * Shared by the server and the chat, so nothing here is server-only.
 */

export const ACTION_KINDS = [
  'notify',
  'count_request',
  'close_count_request',
  'phone_check',
  'review_flags',
  'sales_target',
  'xm_store',
  'deactivate',
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export interface ProposedAction {
  /** Unique within the chat, for the card's state. */
  key: string
  kind: ActionKind
  /** "Send a notification to 14 merchandisers" */
  title: string
  /** The detail, line by line, as the person should check it. */
  lines: string[]
  /** Said in amber above Apply, when there is a catch. */
  warning: string | null
  /** The button's words: "Send", "Request", "Deactivate"… */
  verb: string
  payload: ActionPayload
}

/** A page on the dashboard the assistant points to; opening it changes nothing. */
export interface PageLink {
  label: string
  href: string
}

const uuid = z.string().uuid()

/** What Apply sends back, re-checked by the route that does the work. */
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('notify'),
    payload: z.object({
      title: z.string().max(200),
      body: z.string().max(1000),
      url: z.string().max(300).nullable(),
      audience: z.enum(['everyone', 'role', 'outlet', 'users']),
      role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).nullable(),
      outlet_id: uuid.nullable(),
      user_ids: z.array(uuid).max(500),
    }),
  }),
  z.object({
    kind: z.literal('count_request'),
    payload: z.object({
      user_ids: z.array(uuid).min(1).max(500),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().max(500),
    }),
  }),
  z.object({ kind: z.literal('close_count_request'), payload: z.object({ request_id: uuid }) }),
  z.object({ kind: z.literal('phone_check'), payload: z.object({ user_id: uuid }) }),
  z.object({
    kind: z.literal('review_flags'),
    payload: z.object({ flag_ids: z.array(uuid).min(1).max(100), note: z.string().max(500) }),
  }),
  z.object({
    kind: z.literal('sales_target'),
    payload: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      user_id: uuid.nullable(),
      outlet_id: uuid.nullable(),
      target_units: z.number().int().min(1).max(100_000_000),
    }),
  }),
  z.object({ kind: z.literal('xm_store'), payload: z.object({ outlet_id: uuid, active: z.boolean() }) }),
  z.object({ kind: z.literal('deactivate'), payload: z.object({ user_id: uuid }) }),
])

export type ActionRequest = z.infer<typeof actionSchema>
export type ActionPayload = ActionRequest['payload']

export interface ActionResult {
  ok: boolean
  detail: string
}

/** Pages the assistant may link to, and what each needs. */
export const PAGES = {
  movement: { path: '/admin/tracking', label: 'Movement' },
  excuse: { path: '/admin/excuses', label: 'Check an excuse' },
  attendance: { path: '/admin/attendance', label: 'Attendance' },
  visits: { path: '/admin/visits', label: 'Store visits' },
  integrity: { path: '/admin/integrity', label: 'Integrity flags' },
  stock_counts: { path: '/admin/store-counts', label: 'Stock counts' },
  notifications: { path: '/admin/notifications', label: 'Notifications' },
  staff: { path: '/admin/users', label: 'Staff' },
  stores: { path: '/admin/outlets', label: 'Stores' },
  x_metrics: { path: '/admin/metrics', label: 'X Metrics' },
  audit_log: { path: '/admin/audit', label: 'Audit log' },
  alerts: { path: '/admin/alerts', label: 'Alerts' },
} as const
export type PageName = keyof typeof PAGES
