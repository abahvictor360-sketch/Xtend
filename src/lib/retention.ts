/**
 * How long files are kept before the nightly job deletes them (0067), and
 * what admins and supervisors are told the day before.
 *
 * One rule: nothing is deleted automatically before it is 14 days old
 * (the database's retention_days(), which refuses anything shorter), and
 * nothing before the office was told the day before. What goes:
 * clock-in and store-visit photos (the time, place and distance stay),
 * and report photos and documents that are on no report. Reports, and
 * the photos and documents on a report, are never deleted.
 *
 * Pure on purpose (no Supabase), so scripts/check-retention.ts can test it.
 */
export const RETENTION_DAYS = 14

/** Kept for older callers: the same rule in hours. */
export const SELFIE_RETENTION_HOURS = RETENTION_DAYS * 24

export const SELFIE_RETENTION_NOTE =
  `Clock photos are kept for ${RETENTION_DAYS} days, then deleted. The time, place and distance are kept.`

/** What the database says is due for one admin or supervisor. */
export interface RetentionDue {
  user_id: string
  role: 'admin' | 'supervisor' | string
  selfies: number
  report_photos: number
  report_files: number
}

export interface RetentionMessage {
  title: string
  body: string
  url: string
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** "9 Oct 2026" in Lagos, for the date things were taken before. */
export function retentionDateLabel(through: Date | string) {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(through))
}

/**
 * The day-before notice for one person, or null when nothing of theirs is
 * due. Clock-in photos send them to Attendance, where they can still be
 * opened; files on no report to Marketer reports.
 */
export function retentionMessage(due: RetentionDue, through: Date | string): RetentionMessage | null {
  const selfies = Math.max(0, due.selfies | 0)
  const photos = Math.max(0, due.report_photos | 0)
  const files = Math.max(0, due.report_files | 0)
  if (selfies + photos + files === 0) return null

  const items: string[] = []
  if (selfies) items.push(plural(selfies, 'clock-in photo', 'clock-in photos'))
  if (photos) items.push(plural(photos, 'unused report photo', 'unused report photos'))
  if (files) items.push(plural(files, 'unused report document', 'unused report documents'))
  const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]
  const team = due.role === 'supervisor' ? ' from your team' : ''
  const where = selfies
    ? { page: 'Attendance', url: '/admin/attendance' }
    : { page: 'Marketer reports', url: '/admin/marketer-reports' }
  return {
    title: 'Files deleted tomorrow',
    body:
      `Tomorrow Xtend will delete ${list}${team} older than ${RETENTION_DAYS} days ` +
      `(from before ${retentionDateLabel(through)}). Download anything you need from ${where.page} today. ` +
      'Reports and the files on them are kept.',
    url: where.url,
  }
}

/**
 * Groups people who get the same words, so each group is one notification
 * (one row in the notification history, one push each).
 */
export function groupRetentionNotices(rows: RetentionDue[], through: Date | string) {
  const groups = new Map<string, { message: RetentionMessage; userIds: string[] }>()
  for (const row of rows) {
    const message = retentionMessage(row, through)
    if (!message) continue
    const key = `${message.title}|${message.body}|${message.url}`
    const group = groups.get(key) ?? { message, userIds: [] }
    if (!group.userIds.includes(row.user_id)) group.userIds.push(row.user_id)
    groups.set(key, group)
  }
  return [...groups.values()]
}
