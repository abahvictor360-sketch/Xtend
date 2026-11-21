/**
 * Deleting a store or a person for good (0098): the plain words for what
 * goes with them, from the counts delete_for_good_preview() gives per
 * table. Pure, so scripts/check-delete-for-good.ts can test it.
 */

export type DeleteKind = 'outlet' | 'staff'

/** One table's rows, as the owner would call them: [one, many]. */
export const RECORD_WORDS: Record<string, [string, string]> = {
  attendance: ['clock-in or clock-out', 'clock-ins and clock-outs'],
  location_pings: ['movement point', 'movement points'],
  location_alerts: ['alert', 'alerts'],
  integrity_flags: ['integrity flag', 'integrity flags'],
  store_visits: ['store visit', 'store visits'],
  reports: ['report', 'reports'],
  report_photos: ['report photo', 'report photos'],
  report_files: ['report document', 'report documents'],
  store_counts: ['stock count', 'stock counts'],
  store_count_sheets: ['count sheet', 'count sheets'],
  count_requests: ['count request', 'count requests'],
  count_request_targets: ['count request', 'count requests'],
  staff_outlets: ['store allocation', 'store allocations'],
  leave_requests: ['leave request', 'leave requests'],
  schedule_overrides: ['schedule change', 'schedule changes'],
  work_patterns: ['work pattern', 'work patterns'],
  support_threads: ['support conversation', 'support conversations'],
  support_messages: ['support message', 'support messages'],
  message_threads: ['message conversation', 'message conversations'],
  messages: ['message', 'messages'],
  notification_deliveries: ['notification', 'notifications'],
  excuse_checks: ['excuse check', 'excuse checks'],
  phone_checks: ['phone check', 'phone checks'],
  photo_checks: ['photo check', 'photo checks'],
  field_corrections: ['day correction', 'day corrections'],
  xm_stores: ['X Metrics store setting', 'X Metrics store settings'],
  xm_supplies: ['X Metrics delivery', 'X Metrics deliveries'],
  xm_counts: ['X Metrics count', 'X Metrics counts'],
  xm_sales: ['X Metrics sale', 'X Metrics sales'],
  xm_targets: ['X Metrics target', 'X Metrics targets'],
  xm_expiry_alerts: ['expiry alert', 'expiry alerts'],
  xm_monthly_grades: ['monthly grade', 'monthly grades'],
  user_activity: ['activity log entry', 'activity log entries'],
}

/**
 * Tables that are only the app's own housekeeping (sign-in keys, devices,
 * reminders, tokens): removed too, but not worth listing to the owner.
 */
const QUIET = new Set([
  'push_subscriptions', 'device_beacons', 'tracking_tokens', 'clock_out_reminders', 'staff_temp_passwords',
  'place_naming_due', 'assistant_conversations', 'app_installs', 'follow_sessions', 'message_reads',
  'recent_auth', 'app_update_notices', 'sign_in_keys', 'xm_count_lines', 'xm_sale_lines', 'xm_reconciliations',
  'xm_policy_reads', 'xm_supply_imports',
])

function words(table: string): [string, string] {
  if (RECORD_WORDS[table]) return RECORD_WORDS[table]
  const plain = table.replace(/^xm_/, 'X Metrics ').replace(/_/g, ' ')
  return [plain, plain]
}

/**
 * "12 clock-ins and clock-outs", most first, housekeeping left out; merges
 * tables that read the same. Empty when nothing worth naming goes with it.
 */
export function describeRecords(records: Record<string, number> | null | undefined): string[] {
  const merged = new Map<string, { n: number; w: [string, string] }>()
  for (const [table, raw] of Object.entries(records ?? {})) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || QUIET.has(table)) continue
    const w = words(table)
    const prev = merged.get(w[1])
    merged.set(w[1], { n: (prev?.n ?? 0) + n, w })
  }
  return [...merged.values()]
    .sort((a, b) => b.n - a.n || a.w[1].localeCompare(b.w[1]))
    .map(({ n, w }) => `${n.toLocaleString('en-NG')} ${n === 1 ? w[0] : w[1]}`)
}

/** The name must be typed as shown (spaces at the ends do not matter). */
export function nameMatches(typed: string, name: string) {
  return typed.trim() === name.trim() && name.trim().length > 0
}
