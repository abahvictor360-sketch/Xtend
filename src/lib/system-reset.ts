/**
 * Test mode and resetting the test run (migration 0066). Pure: shared by
 * the System page, the routes and scripts/check-system-reset.ts.
 *
 * The database decides (reset_resolve_categories, reset_test_data); this
 * file mirrors its categories so the page can say exactly what goes and
 * what stays before anyone types RESET.
 */

export type ResetCategoryKey =
  | 'clock_ins'
  | 'visits_places'
  | 'reports'
  | 'stock_counts'
  | 'xm'
  | 'leave_schedules'
  | 'support'
  | 'notifications'
  | 'activity'
  | 'ask'
  | 'teams'
  | 'stores'
  | 'staff'
  | 'audit'

export interface ResetCategory {
  key: ResetCategoryKey
  label: string
  /** What it clears, in plain words. */
  line: string
  /** The tables it empties (staff: removes the non-admin people from). */
  tables: string[]
  /** Other categories it brings with it, and why. */
  requires?: { keys: ResetCategoryKey[]; note: string }
  /** Stored files it removes. */
  files?: string
}

/** In the order the database lists them (reset_category_keys). */
export const RESET_CATEGORIES: ResetCategory[] = [
  {
    key: 'clock_ins',
    label: 'Clock-ins and locations',
    line: 'Clock-ins and clock-outs, location trail, alerts, integrity flags, excuse checks, phone reports, clock-out reminders and live follow sessions.',
    tables: [
      'attendance', 'location_pings', 'location_alerts', 'integrity_flags', 'excuse_checks', 'phone_checks',
      'photo_checks', 'device_beacons', 'clock_out_reminders', 'tracking_tokens', 'follow_sessions',
    ],
    files: 'clock-in selfies',
  },
  {
    key: 'visits_places',
    label: 'Store visits and places',
    line: 'Marketers’ store visits and the places Xtend learned (with their photos).',
    tables: ['store_visits', 'known_places', 'place_naming_due'],
    files: 'visit selfies and place photos',
  },
  {
    key: 'reports',
    label: 'Daily reports',
    line: 'Daily reports with their photos and attached documents.',
    tables: ['reports', 'report_photos', 'report_files'],
    files: 'report photos and documents',
  },
  {
    key: 'stock_counts',
    label: 'Stock counts and count sheets',
    line: 'Store counts, count requests and the count sheets staff sent.',
    tables: ['store_counts', 'count_requests', 'count_request_targets', 'store_count_sheets'],
    files: 'shelf photos and uploaded count sheets',
  },
  {
    key: 'xm',
    label: 'X Metrics records',
    line: 'Batch counts, sales, supplies and imports, reconciliations, grades, expiry alerts, targets and who read the scoring policy.',
    tables: [
      'xm_counts', 'xm_count_lines', 'xm_sales', 'xm_sale_lines', 'xm_supplies', 'xm_supply_imports',
      'xm_reconciliations', 'xm_monthly_grades', 'xm_expiry_alerts', 'xm_targets', 'xm_policy_reads',
    ],
    files: 'count and sales photos',
  },
  {
    key: 'leave_schedules',
    label: 'Leave and schedules',
    line: 'Leave requests, one-off schedule changes and weekly work patterns.',
    tables: ['leave_requests', 'schedule_overrides', 'work_patterns'],
  },
  {
    key: 'support',
    label: 'Support chats',
    line: 'Every support conversation and message, and every message between staff and their supervisor.',
    tables: ['support_threads', 'support_messages', 'message_threads', 'messages', 'message_reads'],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    line: 'Notifications sent and scheduled, and who received them.',
    tables: ['notifications', 'notification_deliveries', 'scheduled_notifications'],
  },
  {
    key: 'activity',
    label: 'Activity log',
    line: 'Sign-ins, sign-outs, app opens, password and photo changes.',
    tables: ['user_activity'],
  },
  {
    key: 'ask',
    label: 'Ask Xtend chats',
    line: 'Saved Ask Xtend conversations, admins’ included.',
    tables: ['assistant_conversations'],
  },
  {
    key: 'teams',
    label: 'Teams and store allocations',
    line: 'Who supervises whom, each person’s home store and store allocations. The people stay.',
    tables: ['staff_outlets'],
  },
  {
    key: 'stores',
    label: 'Stores (outlets)',
    line: 'Every store and its X Metrics enrolment.',
    tables: ['outlets', 'xm_stores'],
    requires: {
      keys: ['visits_places', 'stock_counts', 'xm', 'teams'],
      note: 'Stores also clears the visits, counts, X Metrics records and allocations for those stores. Clock-ins and reports are kept without a store name.',
    },
  },
  {
    key: 'staff',
    label: 'Staff accounts',
    line: 'Every account that is not an admin: supervisors, merchandisers, marketers and added roles, with their sign-ins and profile photos.',
    tables: ['profiles', 'push_subscriptions', 'app_installs', 'staff_temp_passwords'],
    requires: {
      keys: ['clock_ins', 'visits_places', 'reports', 'stock_counts', 'xm'],
      note: 'Staff accounts also clears everything they recorded: clock-ins, visits, reports, counts and X Metrics records. Their leave, support chats, notifications, activity and Ask Xtend chats go with them.',
    },
    files: 'everything in their folders, including profile photos',
  },
  {
    key: 'audit',
    label: 'Audit log',
    line: 'Every audit row. Only the record of this reset is left.',
    tables: ['audit_log'],
  },
]

export const RESET_KEYS: ResetCategoryKey[] = RESET_CATEGORIES.map((c) => c.key)

/** Tables where admins keep their own rows when staff accounts go. */
export const ADMIN_KEPT_TABLES = ['profiles', 'push_subscriptions', 'app_installs', 'staff_temp_passwords']

/** Never touched by a reset. */
export const KEPT_TABLES: { table: string; what: string }[] = [
  { table: 'products', what: 'Product list' },
  { table: 'staff_roles', what: 'Roles you added' },
  { table: 'role_store_counts', what: 'Which roles take stock counts' },
  { table: 'count_sheet_templates', what: 'Count sheet template' },
  { table: 'notification_templates', what: 'Notification templates' },
  { table: 'support_quick_replies', what: 'Support quick replies' },
  { table: 'xm_settings', what: 'X Metrics settings and switches' },
  { table: 'xm_settings_history', what: 'X Metrics settings history' },
  { table: 'xm_policy_versions', what: 'Scoring policy' },
  { table: 'app_releases', what: 'Updates and What’s new' },
  { table: 'job_runs', what: 'Scheduled job bookkeeping' },
  { table: 'system_settings', what: 'Test mode itself' },
  { table: 'system_reset_files', what: 'Files a reset is still removing' },
  { table: 'place_addresses', what: 'Street addresses Google gave for spots with no shop' },
  { table: 'place_lookup_stats', what: 'Counts of place lookups (Google use)' },
]

/** What stays, for the page. */
export const ALWAYS_KEPT = [
  'Admin accounts, their sign-ins and profile photos',
  'The product list',
  'Settings: X Metrics switches and settings, scoring policy, roles, which roles count stock',
  'Notification templates, support quick replies, the count sheet template',
  'Updates and What’s new',
]

export function isResetKey(k: string): k is ResetCategoryKey {
  return (RESET_KEYS as string[]).includes(k)
}

/**
 * What a choice really clears, as the database does it: unknown keys are
 * refused, 'everything' means all, and dependencies come along. Canonical
 * order. Throws on an unknown key or an empty choice.
 */
export function resolveCategories(picked: readonly string[]): ResetCategoryKey[] {
  if (picked.length === 0) throw new Error('Choose at least one thing to reset')
  const set = new Set<ResetCategoryKey>()
  for (const k of picked) {
    if (k === 'everything') RESET_KEYS.forEach((x) => set.add(x))
    else if (isResetKey(k)) set.add(k)
    else throw new Error(`Unknown thing to reset: ${k.slice(0, 40)}`)
  }
  for (const c of RESET_CATEGORIES) {
    if (set.has(c.key) && c.requires) c.requires.keys.forEach((x) => set.add(x))
  }
  return RESET_KEYS.filter((k) => set.has(k))
}

/** The categories brought in by others, with the note that explains each. */
export function addedBy(picked: readonly ResetCategoryKey[]): Map<ResetCategoryKey, ResetCategoryKey[]> {
  const added = new Map<ResetCategoryKey, ResetCategoryKey[]>()
  for (const c of RESET_CATEGORIES) {
    if (!picked.includes(c.key) || !c.requires) continue
    for (const dep of c.requires.keys) {
      if (picked.includes(dep)) continue
      added.set(dep, [...(added.get(dep) ?? []), c.key])
    }
  }
  return added
}

export function isEverything(keys: readonly ResetCategoryKey[]): boolean {
  return RESET_KEYS.every((k) => keys.includes(k))
}

export function categoryLabel(k: string): string {
  return RESET_CATEGORIES.find((c) => c.key === k)?.label ?? k
}

/** The words typed to confirm. Spaces and case are forgiven; nothing else. */
export const RESET_WORD = 'RESET'
export const LIVE_WORDS = 'WE ARE LIVE'

export function confirmMatches(typed: string, expected: string): boolean {
  return typed.trim().replace(/\s+/g, ' ').toUpperCase() === expected
}

/** What the database returns (and the audit row holds). */
export interface ResetResult {
  requested: string[]
  categories: ResetCategoryKey[]
  everything: boolean
  by_category: Partial<Record<ResetCategoryKey, number>>
  also_removed: number
  tables: Record<string, number>
  accounts: number
  auth_fallback: boolean
  files_queued: number
  at: string
}

export interface ResetSummary {
  /** One line per category, in order. */
  lines: { key: ResetCategoryKey; label: string; count: number }[]
  headline: string
  files: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-NG')} ${n === 1 ? one : many}`

/** The result in plain words, for the page. */
export function resetSummary(
  r: Pick<ResetResult, 'categories' | 'by_category' | 'accounts' | 'everything' | 'also_removed'>,
  files: { removed: number; left: number },
): ResetSummary {
  const lines = r.categories.map((key) => ({ key, label: categoryLabel(key), count: r.by_category[key] ?? 0 }))
  const total = lines.reduce((s, l) => s + l.count, 0) + (r.also_removed ?? 0)
  const headline = r.everything
    ? `Xtend is empty again: ${plural(total, 'record')} removed${r.accounts ? `, including ${plural(r.accounts, 'staff account')}` : ''}. Only admins, products and settings are left.`
    : `${plural(total, 'record')} removed from ${plural(lines.length, 'area')}${r.accounts ? `, including ${plural(r.accounts, 'staff account')}` : ''}.`
  const filesLine =
    files.left > 0
      ? `${plural(files.removed, 'file')} removed; ${plural(files.left, 'file')} still to remove.`
      : files.removed > 0
        ? `${plural(files.removed, 'stored file')} removed.`
        : 'No stored files to remove.'
  return { lines, headline, files: filesLine }
}
