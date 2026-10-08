import { z } from 'zod'
import type { PageLink, ProposedAction } from '@/lib/assistant-action-types'
import type { ChangePlan } from '@/lib/assistant-plan'
import { reportSpecSchema, type ReportSpec } from '@/lib/assistant-report-spec'
import { addDays } from '@/lib/utils'

/**
 * Ask Xtend conversations kept for later (assistant_conversations, 054).
 * A kept chat holds the questions, the answers, the report downloads and
 * the page buttons. Proposed actions and plans are kept as words only:
 * reopening an old chat must never offer to send that notification again.
 * Shared by the chat and its routes, so nothing here is server-only.
 */

export interface ChatTurnView {
  role: 'user' | 'assistant'
  content: string
  file?: string
  reports?: ReportSpec[]
  plans?: ChangePlan[]
  actions?: ProposedAction[]
  links?: PageLink[]
  /** What an earlier answer proposed, in words, once it has been kept. */
  earlier?: string[]
}

export const savedTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(40000),
  file: z.string().max(200).optional(),
  reports: z.array(reportSpecSchema).max(10).optional(),
  links: z
    .array(
      z.object({
        label: z.string().max(80),
        // Only pages on this dashboard, never somewhere else.
        href: z.string().max(500).regex(/^\/admin(\/|\?|$)/),
      }),
    )
    .max(10)
    .optional(),
  earlier: z.array(z.string().max(300)).max(20).optional(),
})
export type SavedTurn = z.infer<typeof savedTurnSchema>

export const MAX_SAVED_TURNS = 200
export const savedTurnsSchema = z.array(savedTurnSchema).max(MAX_SAVED_TURNS)

export const conversationTitleSchema = z.string().trim().min(1, 'Give it a name').max(120, 'Keep the name under 120 characters')

export const createConversationSchema = z.object({
  title: conversationTitleSchema.optional(),
  turns: savedTurnsSchema,
})

export const updateConversationSchema = z
  .object({ title: conversationTitleSchema.optional(), turns: savedTurnsSchema.optional() })
  .refine((v) => v.title !== undefined || v.turns !== undefined, 'Nothing to change')

export interface ConversationSummary {
  id: string
  title: string
  updated_at: string
  turn_count: number
}

function planWords(plan: ChangePlan) {
  const parts = [
    plan.stores.length ? `${plan.stores.length} store allocation${plan.stores.length === 1 ? '' : 's'}` : null,
    plan.supervisors.length ? `${plan.supervisors.length} team change${plan.supervisors.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return `A plan: ${parts.join(' and ') || 'no changes'}`
}

/** The chat as it is kept: actions and plans become a line of words each. */
export function toSaved(turns: ChatTurnView[]): SavedTurn[] {
  return turns.slice(-MAX_SAVED_TURNS).map((t) => {
    const earlier = [
      ...(t.earlier ?? []),
      ...(t.actions ?? []).map((a) => a.title),
      ...(t.plans ?? []).map(planWords),
    ]
      .map((e) => e.slice(0, 300))
      .slice(0, 20)
    const saved: SavedTurn = { role: t.role, content: t.content.slice(0, 40000) }
    if (t.file) saved.file = t.file.slice(0, 200)
    if (t.reports?.length) saved.reports = t.reports.slice(0, 10)
    const links = (t.links ?? []).filter((l) => /^\/admin(\/|\?|$)/.test(l.href)).slice(0, 10)
    if (links.length) saved.links = links.map((l) => ({ label: l.label.slice(0, 80), href: l.href.slice(0, 500) }))
    if (earlier.length) saved.earlier = earlier
    return saved
  })
}

/** A kept chat, back as turns the chat can show. Anything malformed is dropped. */
export function fromSaved(value: unknown): ChatTurnView[] {
  if (!Array.isArray(value)) return []
  const turns: ChatTurnView[] = []
  for (const raw of value) {
    const parsed = savedTurnSchema.safeParse(raw)
    if (parsed.success) turns.push(parsed.data)
  }
  return turns
}

/** A name from the first question: whole words, at most about 60 characters. */
export function conversationTitle(question: string) {
  const text = question.replace(/\s+/g, ' ').trim()
  if (!text) return 'New conversation'
  if (text.length <= 60) return text
  const cut = text.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

export type AgeGroup = 'Today' | 'Yesterday' | 'Last 7 days' | 'Older'

/** Kept chats under Today, Yesterday, Last 7 days and Older, newest first. */
export function groupConversations(list: ConversationSummary[], today: string, dayOf: (iso: string) => string) {
  const groups: { label: AgeGroup; items: ConversationSummary[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Last 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  const yesterday = addDays(today, -1)
  const week = addDays(today, -6)
  for (const c of [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const d = dayOf(c.updated_at)
    const i = d >= today ? 0 : d === yesterday ? 1 : d >= week ? 2 : 3
    groups[i].items.push(c)
  }
  return groups.filter((g) => g.items.length > 0)
}

/** Suggested questions, by what they are about. */
export const SUGGESTION_GROUPS: { topic: string; questions: string[] }[] = [
  {
    topic: 'Attendance',
    questions: [
      'Who has not clocked in today?',
      'Who is still on shift and has not clocked out?',
      'Who clocked in late today?',
      'Who clocked in away from their store today?',
      'Who forgot to clock out yesterday?',
      'Who was late most often this week?',
      "Make today's attendance report",
      'Weekly attendance report for this week',
    ],
  },
  {
    topic: 'Visits',
    questions: [
      'Which allocated stores did nobody visit this week?',
      'Who visited the fewest of their stores this week?',
      'How long did each marketer spend in stores today?',
      'Store visits report for this week',
      'Who left their store during their shift today?',
    ],
  },
  {
    topic: 'Stock',
    questions: [
      "Show today's stock counts",
      'Who has not done the stock count they were asked for?',
      'How are X Metrics sales against target this month?',
      'Which stock counts did not add up this month?',
      'Any products close to expiry?',
    ],
  },
  {
    topic: 'Integrity',
    questions: [
      'Who should I look at first for integrity flags?',
      'Who has a fake-GPS flag this week?',
      'Any high integrity flags not yet reviewed?',
      'Bala says his network was bad this morning. Is that true?',
    ],
  },
  {
    topic: 'Staff and support',
    questions: [
      'Any support issues waiting for the office?',
      'What problems have staff raised this week?',
      "Summarise this week's field reports",
      'Which notifications did we send this week, and did they arrive?',
    ],
  },
  {
    topic: 'Actions',
    questions: [
      'Remind everyone who has not clocked in to clock in now',
      'Ask all merchandisers for a stock count by Friday',
      "Check if Ada's phone is on",
      "Show me Ada's movement yesterday",
    ],
  },
]
