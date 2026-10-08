/**
 * The notification history, audiences in plain words, reach figures and
 * scheduling times. Pure, so the page, the composer and
 * scripts/check-support-notifications.ts share it.
 */

export type Audience = 'everyone' | 'role' | 'outlet' | 'users'
export type LogKind = 'message' | 'support' | 'alert'

/** A row of the notification_log view (migration 053). */
export interface LogRow {
  id: string
  sender_id: string | null
  sender_name: string | null
  title: string
  body: string
  url: string | null
  audience: Audience
  audience_detail: Record<string, unknown> | null
  recipients: number
  delivered: number
  failed: number
  created_at: string
  kind: LogKind
  read_count: number
  no_device: number
}

export type DeliveryStatus = 'sent' | 'failed' | 'no_device'

export interface Delivery {
  user_id: string
  status: DeliveryStatus
  detail: string | null
  read_at: string | null
}

export const KIND_LABEL: Record<LogKind, string> = {
  message: 'Messages',
  support: 'Support replies',
  alert: 'Automatic alerts',
}

export const ROLE_PLURAL: Record<string, string> = {
  merchandiser: 'Merchandisers',
  marketer: 'Marketers',
  supervisor: 'Supervisors',
  admin: 'Admins',
}

/** Pages in the staff app a notification can open. */
export const OPEN_PAGES: { url: string; label: string }[] = [
  { url: '/field', label: 'Home (clock in)' },
  { url: '/field/report', label: 'Daily report' },
  { url: '/field/count', label: 'Stock count' },
  { url: '/field/support', label: 'Support' },
  { url: '/field/history', label: 'History' },
]

/** "Everyone", "Merchandisers", "Ikeja City Mall", "Ada Okafor and 2 others". */
export function audienceText(
  audience: Audience,
  detail: Record<string, unknown> | null,
  names: { outlets?: Map<string, string>; people?: Map<string, string> } = {},
) {
  const d = detail ?? {}
  if (audience === 'everyone') return 'Everyone'
  if (audience === 'role') return ROLE_PLURAL[String(d.role)] ?? 'One role'
  if (audience === 'outlet') return names.outlets?.get(String(d.outlet_id)) ?? 'One store'
  const ids = Array.isArray(d.user_ids) ? (d.user_ids as string[]) : []
  if (ids.length === 0) return 'Named people'
  const first = names.people?.get(ids[0])
  if (!first) return `${ids.length} ${ids.length === 1 ? 'person' : 'people'}`
  return ids.length === 1 ? first : `${first} and ${ids.length - 1} other${ids.length === 2 ? '' : 's'}`
}

/** Whole percent, or null when nothing was aimed at anyone. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

export interface Summary {
  sent: number
  recipients: number
  delivered: number
  read: number
  /** Delivered of targeted, %. */
  deliveryRate: number | null
  /** Read in the app of delivered, %. */
  readRate: number | null
}

/** Office messages (not alerts or support replies) since a moment. */
export function summarise(rows: LogRow[], since: Date): Summary {
  const mine = rows.filter((r) => r.kind === 'message' && new Date(r.created_at).getTime() >= since.getTime())
  const recipients = mine.reduce((n, r) => n + r.recipients, 0)
  const delivered = mine.reduce((n, r) => n + r.delivered, 0)
  const read = mine.reduce((n, r) => n + r.read_count, 0)
  return {
    sent: mine.length,
    recipients,
    delivered,
    read,
    deliveryRate: percent(delivered, recipients),
    readRate: percent(read, delivered),
  }
}

/** Who did not get it: failed, or had notifications off. */
export function notReached(deliveries: Delivery[]) {
  return deliveries.filter((d) => d.status !== 'sent').map((d) => d.user_id)
}

export function deliveryGroups(deliveries: Delivery[]) {
  return {
    read: deliveries.filter((d) => d.status === 'sent' && d.read_at),
    unread: deliveries.filter((d) => d.status === 'sent' && !d.read_at),
    failed: deliveries.filter((d) => d.status === 'failed'),
    off: deliveries.filter((d) => d.status === 'no_device'),
  }
}

// ---------------------------------------------------------------------
// Scheduling. Lagos is UTC+1 all year (no daylight saving).
// ---------------------------------------------------------------------

/** The instant of a Lagos wall-clock date and HH:MM. */
export function lagosAt(date: string, hm: string) {
  return new Date(`${date}T${hm}:00+01:00`).toISOString()
}

function lagosParts(now: Date) {
  const lagos = new Date(now.getTime() + 3_600_000)
  return { date: lagos.toISOString().slice(0, 10), minutes: lagos.getUTCHours() * 60 + lagos.getUTCMinutes() }
}

function nextDay(date: string, n = 1) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Quick picks: the next 7:45, the next 8:00 and this or next 13:00, skipping times too close. */
export function scheduleChoices(now: Date): { label: string; date: string; time: string }[] {
  const { date: today } = lagosParts(now)
  const tomorrow = nextDay(today)
  const pick = (time: string, words: string) => {
    const todayAt = new Date(lagosAt(today, time))
    const ok = todayAt.getTime() - now.getTime() >= MIN_AHEAD_MIN * 60_000
    return ok
      ? { label: `Today ${words}`, date: today, time }
      : { label: `Tomorrow ${words}`, date: tomorrow, time }
  }
  return [pick('07:45', '7:45'), pick('08:00', '8:00'), pick('13:00', '1 pm'), pick('16:00', '4 pm')]
}

/** The database refuses anything under two minutes ahead; the form asks for five. */
export const MIN_AHEAD_MIN = 5
export const MAX_AHEAD_DAYS = 60

export function scheduleProblem(sendAt: Date, now: Date): string | null {
  if (Number.isNaN(sendAt.getTime())) return 'Pick a day and a time.'
  const ahead = sendAt.getTime() - now.getTime()
  if (ahead < MIN_AHEAD_MIN * 60_000) return `Pick a time at least ${MIN_AHEAD_MIN} minutes from now.`
  if (ahead > MAX_AHEAD_DAYS * 86_400_000) return `Pick a time within the next ${MAX_AHEAD_DAYS} days.`
  return null
}

/** The five-minute job is late on this one: it should have gone by now. */
export function isOverdue(sendAt: string, now: Date, graceMinutes = 15) {
  return now.getTime() - new Date(sendAt).getTime() > graceMinutes * 60_000
}

export interface NotificationFilter {
  kind: LogKind | 'all'
  q: string | null
  days: 7 | 30 | 90
  n: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseNotificationFilter(search: Record<string, string | undefined>): NotificationFilter {
  const kind = ['message', 'support', 'alert', 'all'].includes(search.kind ?? '')
    ? (search.kind as NotificationFilter['kind'])
    : 'message'
  const days = search.days === '7' ? 7 : search.days === '90' ? 90 : 30
  const q = (search.q ?? '').trim().slice(0, 80)
  return { kind, q: q || null, days, n: UUID.test(search.n ?? '') ? search.n! : null }
}

export function notificationQuery(f: NotificationFilter, change: Partial<NotificationFilter> = {}) {
  const next = { ...f, ...change }
  const q = new URLSearchParams()
  if (next.kind !== 'message') q.set('kind', next.kind)
  if (next.q) q.set('q', next.q)
  if (next.days !== 30) q.set('days', String(next.days))
  if (next.n) q.set('n', next.n)
  return q.toString()
}

export function matchesLog(row: LogRow, q: string | null) {
  if (!q) return true
  const hay = `${row.title} ${row.body} ${row.sender_name ?? ''}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}
