/**
 * The office's support inbox: which threads need a person, how long the
 * member has been waiting, filters, sorting and reply times. Pure, so the
 * page, the panel and scripts/check-support-notifications.ts share it.
 */

export type SupportStatus = 'open' | 'ai_answered' | 'escalated' | 'resolved'
export type SupportSender = 'staff' | 'ai' | 'admin' | 'supervisor'

/** A row of the support_inbox view (migration 053). */
export interface InboxThread {
  id: string
  user_id: string
  staff_name: string
  staff_role: string
  subject: string
  status: SupportStatus
  outlet_id: string | null
  outlet_name: string | null
  created_at: string
  last_message_at: string
  escalated_at: string | null
  resolved_at: string | null
  resolved_by_name: string | null
  assigned_to: string | null
  assigned_name: string | null
  assigned_at: string | null
  message_count: number
  last_body: string | null
  last_sender: SupportSender | null
  last_office_at: string | null
  office_replies: number
  /** When the member's oldest message not yet answered by a person was sent. */
  waiting_since: string | null
}

export interface ThreadMessage {
  id?: string
  thread_id: string
  sender_role: SupportSender
  body?: string
  created_at: string
}

export const VIEWS = ['needs', 'mine', 'answered', 'closed', 'all'] as const
export type View = (typeof VIEWS)[number]
export const VIEW_LABEL: Record<View, string> = {
  needs: 'Needs a reply',
  mine: 'Given to me',
  answered: 'Answered',
  closed: 'Closed',
  all: 'All',
}

export const SORTS = ['waiting', 'newest', 'oldest'] as const
export type Sort = (typeof SORTS)[number]
export const SORT_LABEL: Record<Sort, string> = {
  waiting: 'Longest waiting first',
  newest: 'Latest message first',
  oldest: 'Oldest thread first',
}

/** Waiting longer than this is flagged; the summary counts it. */
export const LONG_WAIT_MIN = 60
/** And longer than this is shown as late. */
export const LATE_WAIT_MIN = 240

const OFFICE: SupportSender[] = ['admin', 'supervisor']

export function needsReply(t: Pick<InboxThread, 'status'>) {
  return t.status === 'open' || t.status === 'escalated'
}

export function inView(t: InboxThread, view: View, me: string) {
  switch (view) {
    case 'needs':
      return needsReply(t)
    case 'mine':
      return t.assigned_to === me && t.status !== 'resolved'
    case 'answered':
      return t.status === 'ai_answered'
    case 'closed':
      return t.status === 'resolved'
    default:
      return true
  }
}

export function viewCounts(threads: InboxThread[], me: string): Record<View, number> {
  const out = { needs: 0, mine: 0, answered: 0, closed: 0, all: 0 } as Record<View, number>
  for (const t of threads) for (const v of VIEWS) if (inView(t, v, me)) out[v] += 1
  return out
}

export type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'outline'

export function statusLabel(t: Pick<InboxThread, 'status' | 'last_sender' | 'office_replies'>): {
  label: string
  variant: BadgeVariant
} {
  switch (t.status) {
    case 'escalated':
      return { label: 'With the office', variant: 'destructive' }
    case 'open':
      return { label: 'Waiting', variant: 'warning' }
    case 'resolved':
      return { label: 'Closed', variant: 'outline' }
    default:
      return t.last_sender && OFFICE.includes(t.last_sender)
        ? { label: 'Office answered', variant: 'success' }
        : { label: 'Helper answered', variant: 'default' }
  }
}

/** Minutes the member has been waiting for a person, or null if nothing waits. */
export function minutesWaiting(t: Pick<InboxThread, 'status' | 'waiting_since'>, now: Date): number | null {
  if (!needsReply(t) || !t.waiting_since) return null
  const ms = now.getTime() - new Date(t.waiting_since).getTime()
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : null
}

/** "5 min", "2 h", "2 h 30 min", "3 days". */
export function durationText(minutes: number) {
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  if (m < 24 * 60) {
    const h = Math.floor(m / 60)
    const rest = m % 60
    // Past a few hours, the minutes are noise.
    return rest && h < 3 ? `${h} h ${rest} min` : `${h} h`
  }
  const d = Math.floor(m / (24 * 60))
  return `${d} day${d === 1 ? '' : 's'}`
}

export function waitText(minutes: number) {
  return minutes < 1 ? 'waiting just now' : `waiting ${durationText(minutes)}`
}

export function waitTone(minutes: number): 'ok' | 'warn' | 'late' {
  return minutes >= LATE_WAIT_MIN ? 'late' : minutes >= LONG_WAIT_MIN ? 'warn' : 'ok'
}

const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0)

export function sortThreads(threads: InboxThread[], sort: Sort): InboxThread[] {
  const out = [...threads]
  if (sort === 'newest') return out.sort((a, b) => time(b.last_message_at) - time(a.last_message_at))
  if (sort === 'oldest') return out.sort((a, b) => time(a.created_at) - time(b.created_at))
  // Waiting: whoever has waited longest at the top, then the rest by latest.
  return out.sort((a, b) => {
    const wa = needsReply(a) && a.waiting_since ? time(a.waiting_since) : null
    const wb = needsReply(b) && b.waiting_since ? time(b.waiting_since) : null
    if (wa !== null && wb !== null) return wa - wb
    if (wa !== null) return -1
    if (wb !== null) return 1
    return time(b.last_message_at) - time(a.last_message_at)
  })
}

/** Name, store, subject or last message contains the words; or a message did (hits). */
export function matchesSearch(t: InboxThread, q: string, messageHits?: Set<string>) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  if (messageHits?.has(t.id)) return true
  const hay = [t.staff_name, t.outlet_name, t.subject, t.last_body, t.assigned_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * How long the office took to answer, in minutes: for each office message,
 * the time since the first member message it was answering. A message with
 * nothing new from the member before it (a second note) does not count.
 */
export function replyMinutes(messages: ThreadMessage[], since?: Date): number[] {
  const byThread = new Map<string, ThreadMessage[]>()
  for (const m of messages) {
    const list = byThread.get(m.thread_id) ?? []
    list.push(m)
    byThread.set(m.thread_id, list)
  }
  const out: number[] = []
  for (const list of byThread.values()) {
    list.sort((a, b) => time(a.created_at) - time(b.created_at))
    let waitingFrom: number | null = null
    for (const m of list) {
      if (m.sender_role === 'staff') {
        if (waitingFrom === null) waitingFrom = time(m.created_at)
      } else if (OFFICE.includes(m.sender_role)) {
        if (waitingFrom !== null && (!since || time(m.created_at) >= since.getTime())) {
          out.push(Math.max(0, (time(m.created_at) - waitingFrom) / 60_000))
        }
        waitingFrom = null
      }
    }
  }
  return out
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Threads the office answered on a Lagos day (YYYY-MM-DD). */
export function answeredOn(messages: ThreadMessage[], day: string, lagosDay: (iso: string) => string) {
  const ids = new Set<string>()
  for (const m of messages) {
    if (OFFICE.includes(m.sender_role) && lagosDay(m.created_at) === day) ids.add(m.thread_id)
  }
  return ids.size
}

/** A quick reply with {name} filled with the member's first name. */
export function fillReply(body: string, fullName: string) {
  const first = fullName.trim().split(/\s+/)[0] || 'there'
  return body.replace(/\{name\}/gi, first)
}

export interface SupportFilter {
  view: View
  person: string | null
  q: string | null
  sort: Sort
  thread: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseSupportFilter(search: Record<string, string | undefined>): SupportFilter {
  const view = (VIEWS as readonly string[]).includes(search.view ?? '') ? (search.view as View) : 'needs'
  const sort = (SORTS as readonly string[]).includes(search.sort ?? '') ? (search.sort as Sort) : 'waiting'
  const q = (search.q ?? '').trim().slice(0, 80)
  return {
    view,
    person: UUID.test(search.person ?? '') ? search.person! : null,
    q: q || null,
    sort,
    thread: UUID.test(search.thread ?? '') ? search.thread! : null,
  }
}

/** The query string for a filter; defaults are left out. */
export function supportQuery(f: SupportFilter, change: Partial<SupportFilter> = {}) {
  const next = { ...f, ...change }
  const q = new URLSearchParams()
  if (next.view !== 'needs') q.set('view', next.view)
  if (next.person) q.set('person', next.person)
  if (next.q) q.set('q', next.q)
  if (next.sort !== 'waiting') q.set('sort', next.sort)
  if (next.thread) q.set('thread', next.thread)
  return q.toString()
}
