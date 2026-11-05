/**
 * What Ask Xtend may reuse instead of working out again, and for how long.
 * Pure on purpose (no server, no clock but the day passed in), so
 * scripts/check-assistant-cache.ts can test it.
 *
 * Two things are reused, both only on the same server and only briefly:
 *   - a lookup the assistant already made (a day's attendance, a month's
 *     metrics): a past day cannot change, so it is kept for hours; anything
 *     that includes today is kept for a minute or two;
 *   - the whole answer to a question that was just asked the same way by the
 *     same person: five minutes, never when the turn proposed a change or a
 *     report (those are one-off cards) and never after a lookup failed.
 */

/** Tools whose result depends only on who asks and what they asked. */
export const CACHEABLE_TOOLS = new Set([
  'attendance_on_day',
  'staff_history',
  'attendance_summary',
  'field_reports',
  'store_visits',
  'store_counts',
  'integrity_risk',
  'location_alerts',
  'support_threads',
  'notifications_sent',
  'x_metrics',
  'store_coverage',
])

export const ANSWER_TTL_MS = 5 * 60_000
export const LOOKUP_TODAY_TTL_MS = 90_000
export const LOOKUP_PAST_TTL_MS = 6 * 3_600_000

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

/** JSON with the keys in a fixed order, so the same input is the same key. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * How long a lookup may be kept, given what it asked about: 0 for a tool
 * that is not cached; hours when every date in it is before `today`
 * (`today` is YYYY-MM-DD); a minute or two otherwise (today, or a range
 * with no end, which means up to today).
 */
export function lookupTtlMs(tool: string, input: Record<string, unknown>, today: string): number {
  if (!CACHEABLE_TOOLS.has(tool)) return 0
  const end = [input.date, input.to].find((v): v is string => typeof v === 'string' && DAY.test(v))
  const month = typeof input.month === 'string' && MONTH.test(input.month) ? input.month : null
  if (month) return month < today.slice(0, 7) ? LOOKUP_PAST_TTL_MS : LOOKUP_TODAY_TTL_MS
  if (end && end < today) return LOOKUP_PAST_TTL_MS
  return LOOKUP_TODAY_TTL_MS
}

/** The key for one lookup by one asker (what decides what they may see). */
export function lookupKey(scope: string, tool: string, input: Record<string, unknown>): string {
  return `${scope}|${tool}|${stableJson(input)}`
}

/** A question as typed, folded so trivial differences still match. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?,;:]+$/g, '')
    .trim()
}

/**
 * The key for a saved answer, or null when this turn must not be saved or
 * served from a saved one: a follow-up (it depends on the chat before it)
 * or a question with a file.
 */
export function answerKey(
  scope: string,
  today: string,
  history: { role: string; content: string }[],
  hasAttachment: boolean,
): string | null {
  if (hasAttachment || history.length !== 1 || history[0].role !== 'user') return null
  const q = normalizeQuestion(history[0].content)
  if (!q) return null
  return `${scope}|${today}|${q}`
}

/** Whether a finished turn is worth saving. */
export function answerWorthSaving(turn: {
  plans: number
  actions: number
  reports: number
  lookupFailed: boolean
  answered: boolean
}): boolean {
  return turn.answered && !turn.lookupFailed && turn.plans === 0 && turn.actions === 0 && turn.reports === 0
}
