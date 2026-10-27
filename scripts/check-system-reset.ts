/**
 * Checks test mode and the reset (src/lib/system-reset.ts, migration 0066):
 * the typed confirmations, which categories a choice really clears, that
 * every table is classified exactly once and matches the database's own
 * list, and the summary shown after a reset.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-system-reset.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADMIN_KEPT_TABLES,
  KEPT_TABLES,
  LIVE_WORDS,
  RESET_CATEGORIES,
  RESET_KEYS,
  RESET_WORD,
  addedBy,
  confirmMatches,
  isEverything,
  resetSummary,
  resolveCategories,
} from '@/lib/system-reset'
import { actionGroup, actionLabel } from '@/lib/audit-log'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const throws = (f: () => unknown) => {
  try {
    f()
    return false
  } catch {
    return true
  }
}

// Every table in the database (docs/rebuild/generated/database.md, plus
// 0066's two and 0068's two), as the owner classified them.
const FIXTURE: Record<string, 'wipe' | 'admins-kept' | 'keep'> = {
  app_installs: 'admins-kept', app_releases: 'keep', assistant_conversations: 'wipe', attendance: 'wipe',
  audit_log: 'wipe', clock_out_reminders: 'wipe', count_request_targets: 'wipe', count_requests: 'wipe',
  count_sheet_templates: 'keep', device_beacons: 'wipe', excuse_checks: 'wipe', integrity_flags: 'wipe',
  job_runs: 'keep', known_places: 'wipe', leave_requests: 'wipe', location_alerts: 'wipe', location_pings: 'wipe',
  notification_deliveries: 'wipe', notification_templates: 'keep', notifications: 'wipe', outlets: 'wipe',
  phone_checks: 'wipe', photo_checks: 'wipe', place_naming_due: 'wipe', products: 'keep', profiles: 'admins-kept',
  push_subscriptions: 'admins-kept', report_files: 'wipe', report_photos: 'wipe', reports: 'wipe',
  role_store_counts: 'keep', schedule_overrides: 'wipe', scheduled_notifications: 'wipe', staff_outlets: 'wipe',
  staff_roles: 'keep', staff_temp_passwords: 'admins-kept', store_count_sheets: 'wipe', store_counts: 'wipe',
  store_visits: 'wipe', support_messages: 'wipe', support_quick_replies: 'keep', support_threads: 'wipe',
  system_reset_files: 'keep', system_settings: 'keep', tracking_tokens: 'wipe', user_activity: 'wipe',
  work_patterns: 'wipe', xm_count_lines: 'wipe', xm_counts: 'wipe', xm_expiry_alerts: 'wipe',
  xm_monthly_grades: 'wipe', xm_policy_reads: 'wipe', xm_policy_versions: 'keep', xm_reconciliations: 'wipe',
  xm_sale_lines: 'wipe', xm_sales: 'wipe', xm_settings: 'keep', xm_settings_history: 'keep', xm_stores: 'wipe',
  xm_supplies: 'wipe', xm_supply_imports: 'wipe', xm_targets: 'wipe',
  // 0068: map answers and counts, not anybody's records.
  place_addresses: 'keep', place_lookup_stats: 'keep',
}

// --- Typed confirmations.
check(confirmMatches('RESET', RESET_WORD), 'RESET confirms')
check(confirmMatches('  reset ', RESET_WORD), 'case and spaces are forgiven')
check(!confirmMatches('RESE', RESET_WORD) && !confirmMatches('', RESET_WORD) && !confirmMatches('RESET!', RESET_WORD),
  'anything else does not')
check(confirmMatches('we are  live', LIVE_WORDS), 'WE ARE LIVE confirms going live')
check(!confirmMatches('RESET', LIVE_WORDS) && !confirmMatches('WE ARE', LIVE_WORDS), 'and nothing else does')

// --- Classification: each table exactly once, and the same as the database.
const wipeTables = RESET_CATEGORIES.filter((c) => c.key !== 'staff').flatMap((c) => c.tables)
const staffTables = RESET_CATEGORIES.find((c) => c.key === 'staff')!.tables
const kept = KEPT_TABLES.map((k) => k.table)
const all = [...wipeTables, ...staffTables, ...kept]
check(all.length === new Set(all).size, 'no table is in two places', all.filter((t, i) => all.indexOf(t) !== i))
check(same([...all].sort(), Object.keys(FIXTURE).sort()), 'every table in the database is classified',
  Object.keys(FIXTURE).filter((t) => !all.includes(t)).concat(all.filter((t) => !(t in FIXTURE))))
check(wipeTables.every((t) => FIXTURE[t] === 'wipe'), 'the cleared tables are the ones to wipe')
check(same([...staffTables].sort(), [...ADMIN_KEPT_TABLES].sort()) && staffTables.every((t) => FIXTURE[t] === 'admins-kept'),
  'staff accounts take the people out of the tables admins keep rows in')
check(kept.every((t) => FIXTURE[t] === 'keep'), 'the kept tables are kept')
check(RESET_CATEGORIES.every((c) => c.tables.length > 0), 'every category clears something')

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0066_test_mode_reset.sql'), 'utf8').replace(/\r\n/g, '\n')
const fromSql = new Map<string, string>()
for (const m of sql.matchAll(/'([a-z_]+):([a-z_]+)'/g)) fromSql.set(m[2], m[1])
check(fromSql.size === wipeTables.length, 'the database lists the same number of tables', fromSql.size)
check(RESET_CATEGORIES.filter((c) => c.key !== 'staff').every((c) => c.tables.every((t) => fromSql.get(t) === c.key)),
  'and puts each in the same category as this page',
  [...fromSql].filter(([t, c]) => RESET_CATEGORIES.find((x) => x.tables.includes(t))?.key !== c))
const keysSql = sql.match(/select array\[([^\]]+)\];\n\$\$;\n\ncreate or replace function public\.reset_category_tables/)
check(Boolean(keysSql) && same(keysSql![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1)), RESET_KEYS),
  'the categories are in the database’s order')
check(same(sql.match(/reset_staff_tables\(\)[\s\S]*?array\[([^\]]+)\]/)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1)), staffTables),
  'and the admin-kept tables match')

// --- What a choice clears.
check(same(resolveCategories(['support']), ['support']), 'one category on its own')
check(same(resolveCategories(['staff']), ['clock_ins', 'visits_places', 'reports', 'stock_counts', 'xm', 'staff']),
  'staff accounts bring what they recorded')
check(same(resolveCategories(['stores']), ['visits_places', 'stock_counts', 'xm', 'teams', 'stores']),
  'stores bring their visits, counts, X Metrics records and allocations')
check(same(resolveCategories(['audit', 'support']), ['support', 'audit']), 'returned in the database’s order')
check(same(resolveCategories(['everything']), RESET_KEYS) && isEverything(resolveCategories(['everything'])),
  'everything is all of them')
check(isEverything(resolveCategories(['staff', 'stores', 'leave_schedules', 'support', 'notifications', 'activity', 'ask', 'audit'])),
  'ticking every box by hand is everything too')
check(!isEverything(resolveCategories(['staff'])), 'staff alone is not everything')
check(throws(() => resolveCategories([])), 'nothing chosen is refused')
check(throws(() => resolveCategories(['products'])), 'an unknown category is refused')
const why = addedBy(['staff'])
check(same(why.get('clock_ins'), ['staff']) && !why.has('staff') && !why.has('support'),
  'the page says which choice brought each extra one', [...why])
check(same(addedBy(['stores', 'staff']).get('xm'), ['stores', 'staff']), 'one brought by two choices names both')
check(!addedBy(['staff', 'xm']).has('xm'), 'one ticked by hand is not called added')

// --- The summary.
const s = resetSummary(
  { categories: ['support', 'audit'], by_category: { support: 8, audit: 38 }, accounts: 0, everything: false, also_removed: 0 },
  { removed: 0, left: 0 },
)
check(s.headline === '46 records removed from 2 areas.', 'a partial reset says how much from how many areas', s.headline)
check(same(s.lines.map((l) => [l.label, l.count]), [['Support chats', 8], ['Audit log', 38]]), 'one line per area')
check(s.files === 'No stored files to remove.', 'no files', s.files)
const full = resetSummary(
  { categories: resolveCategories(['everything']), by_category: { staff: 57, clock_ins: 166 }, accounts: 40, everything: true, also_removed: 0 },
  { removed: 90, left: 0 },
)
check(full.headline.startsWith('Xtend is empty again: 223 records removed, including 40 staff accounts.'),
  'a full reset says Xtend is empty again', full.headline)
check(full.lines.length === RESET_KEYS.length && full.lines.find((l) => l.key === 'ask')?.count === 0,
  'every area is listed, with nought where nothing was there')
check(full.files === '90 stored files removed.', 'files removed', full.files)
const partial = resetSummary(
  { categories: ['staff'], by_category: { staff: 1 }, accounts: 1, everything: false, also_removed: 5 },
  { removed: 1000, left: 1 },
)
check(partial.headline === '6 records removed from 1 area, including 1 staff account.', 'singular words', partial.headline)
check(partial.files === '1,000 files removed; 1 file still to remove.', 'files left to remove', partial.files)

// --- The audit log names the reset rows.
check(actionLabel('system.reset') === 'Reset test records' && actionGroup('system.reset') === 'System',
  'the audit log names a reset')
check(actionLabel('system.go_live') === 'Turned off test mode (went live)', 'and going live')

if (failed) {
  console.log(`${failed} SYSTEM RESET CHECK(S) FAILED`)
  process.exit(1)
}
console.log('ALL SYSTEM RESET CHECKS PASSED')
