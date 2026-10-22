/**
 * Checks the pure parts of the Activity log (migration 062): the filter,
 * the plain-English detail, grouping by Lagos day, the per-person lines,
 * the summary cards and the download rows.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-activity.ts
 */
import {
  ACTIVITY_COLUMNS,
  ACTIVITY_GROUPS,
  MAX_RANGE_DAYS,
  activityExportRows,
  activityPresets,
  activityQueryString,
  activitySheet,
  daysBetween,
  detailText,
  deviceText,
  filterKinds,
  groupByDay,
  kindGroup,
  parseActivityFilter,
  perPerson,
  personLinks,
  summarise,
  type ActivityRow,
} from '@/lib/activity-log'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const today = '2026-10-22'
const ADA = '11111111-1111-4111-8111-111111111111'
const BOSS = '22222222-2222-4222-8222-222222222222'

// ---- The filter ----
let f = parseActivityFilter({}, today)
check(f.from === today && f.to === today && f.person === null && f.group === null, 'no filter means today, everyone, everything', f)
f = parseActivityFilter({ from: '2026-10-20', to: '2026-10-10', person: 'x; drop table', group: 'nonsense' }, today)
check(f.from === '2026-10-10' && f.to === '2026-10-20', 'dates the wrong way round are swapped', f)
check(f.person === null && f.group === null, 'a bad person or group is ignored', f)
f = parseActivityFilter(new URLSearchParams({ from: '2027-01-01', person: ADA, group: 'clock' }), today)
check(f.from === today && f.to === today && f.person === ADA && f.group === 'clock', 'no dates after today; a real person and group are kept', f)
f = parseActivityFilter({ from: '2025-01-01', to: '2026-10-22' }, today)
check(daysBetween(f.from, f.to) === MAX_RANGE_DAYS && f.to === today, `a long range is cut to the last ${MAX_RANGE_DAYS} days`, f)
f = parseActivityFilter({ to: '2026-10-15' }, today)
check(f.from === '2026-10-15' && f.to === '2026-10-15', 'only an end date means that one day', f)
f = parseActivityFilter({ from: '2026-02-30' }, today)
check(f.from === today, 'an impossible date is ignored', f)
check(
  activityQueryString({ from: '2026-10-01', to: '2026-10-07', person: ADA, group: 'leave' }) ===
    `from=2026-10-01&to=2026-10-07&person=${ADA}&group=leave`,
  'the query string carries every filter, for the downloads too',
)
const presets = activityPresets(today)
check(
  presets.map((p) => `${p.label}:${p.from}:${p.to}`).join('|') ===
    'Today:2026-10-22:2026-10-22|Yesterday:2026-10-21:2026-10-21|Last 7 days:2026-10-16:2026-10-22|Last 30 days:2026-09-23:2026-10-22',
  'quick ranges: today, yesterday, last 7 and 30 days',
  presets,
)
check(JSON.stringify(filterKinds('signin')) === '["sign_in","sign_out"]' && filterKinds(null) === null, 'a group asks the database for its kinds')
check(kindGroup('xm_sales') === 'work' && kindGroup('visit_out') === 'visits' && kindGroup('made_up') === null, 'every kind belongs to one group')
check(
  Object.values(ACTIVITY_GROUPS).flatMap((g) => g.kinds).length === new Set(Object.values(ACTIVITY_GROUPS).flatMap((g) => g.kinds)).size,
  'no kind is in two groups',
)

// ---- Sample activity, newest first, as the database returns it ----
const row = (at: string, user: string, kind: string, label: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  at,
  user_id: user,
  full_name: user === ADA ? 'Ada Okafor' : 'Ngozi Eze',
  role: user === ADA ? 'merchandiser' : 'admin',
  kind,
  label,
  detail: {},
  ip: null,
  platform: null,
  device: null,
  user_agent: null,
  ...extra,
})
const rows: ActivityRow[] = [
  row('2026-10-22T16:05:00Z', ADA, 'clock_out', 'Clocked out at Ikeja City Mall', { detail: { status: 'on_site', distance_m: 12 }, platform: 'android', device: 'Xtend app on Android 14' }),
  row('2026-10-22T09:00:00Z', BOSS, 'app_open', 'Opened the app', { platform: 'web', device: 'Chrome 128 on Windows 10/11', ip: '102.89.1.1' }),
  row('2026-10-22T08:10:00Z', ADA, 'leave_applied', 'Asked for leave', { detail: { type: 'annual', from: '2026-11-10', to: '2026-11-12' } }),
  row('2026-10-22T07:02:00Z', ADA, 'clock_in', 'Clocked in at Ikeja City Mall', { detail: { status: 'off_site', distance_m: 340 }, platform: 'android' }),
  row('2026-10-22T07:00:00Z', ADA, 'app_open', 'Opened the app', { platform: 'android', device: 'Xtend app on Android 14', ip: '102.89.33.7', detail: { app_build: 131 } }),
  row('2026-10-21T23:30:00Z', ADA, 'sign_in', 'Signed in', { platform: 'android', device: 'Xtend app on Android 14', ip: '102.89.33.7' }),
  row('2026-10-21T22:30:00Z', BOSS, 'sign_out', 'Signed out (login expired)', { detail: { reason: 'new-day' } }),
  row('2026-10-21T10:00:00Z', BOSS, 'sign_in', 'Signed in', { platform: 'web', device: 'Chrome 128 on Windows 10/11' }),
]

// ---- Plain English ----
check(detailText(rows[0]) === 'on site · 12 m from the store', 'a clock-out: status and distance', detailText(rows[0]))
check(detailText(rows[2]) === 'Annual leave, 10 Nov to 12 Nov', 'leave: type and dates', detailText(rows[2]))
check(detailText(rows[4]) === 'app build 131', 'an app open names the app build', detailText(rows[4]))
check(detailText(rows[6]) === 'a new day', 'an expired login says why', detailText(rows[6]))
check(
  detailText({ kind: 'visit_out', detail: { store: 'Allen', minutes: 45, distance_m: 9 } }) === '45 min in the store',
  'a store check-out: time in the store',
)
check(
  detailText({ kind: 'stock_count', detail: { store: 'Allen', products: 1 } }) === '1 product',
  'a stock count: how many products',
)
check(detailText({ kind: 'support_message', detail: { subject: 'Phone is slow' } }) === '“Phone is slow”', 'a support message: its subject')
check(detailText({ kind: 'password_changed', detail: { first: true } }) === 'replacing the temporary password', 'a first password says so')
check(detailText({ kind: 'sign_in', detail: null }) === '', 'nothing to add, nothing shown')
check(deviceText(rows[0]) === 'Xtend app on Android 14 · Android app', 'device and platform together', deviceText(rows[0]))
check(deviceText({ device: null, platform: 'ios' }) === 'iPhone app', 'platform alone when the device is not known')
check(deviceText({ device: null, platform: null }) === 'Unknown device', 'neither known')

// ---- Days, in Lagos ----
const days = groupByDay(rows)
check(days.length === 2 && days[0].day === '2026-10-22' && days[1].day === '2026-10-21', 'grouped by Lagos day, newest first', days.map((d) => d.day))
check(days[0].rows.length === 6 && days[0].rows[5].kind === 'sign_in', '23:30 UTC is already the next day in Lagos', days[0].rows.map((r) => r.kind))
check(days[0].title === 'Thursday, 22 October 2026' || days[0].title.includes('22 October 2026'), 'each day has a readable title', days[0].title)
check(days[1].rows.length === 2 && days[1].rows[0].kind === 'sign_out', 'and keeps newest first within a day')

// ---- People and the summary ----
const people = perPerson(rows)
check(people.length === 2 && people[0].full_name === 'Ada Okafor', 'busiest person first', people.map((p) => p.full_name))
const ada = people[0]
check(ada.signIns === 1 && ada.appOpens === 1 && ada.actions === 3 && ada.total === 5, 'sign-ins, app opens and actions counted apart', ada)
check(ada.first === '2026-10-21T23:30:00Z' && ada.last === '2026-10-22T16:05:00Z', 'first and last activity', ada)
check(ada.lastDevice === 'Xtend app on Android 14' && ada.lastPlatform === 'android' && ada.lastIp === '102.89.33.7', 'the newest known device, platform and IP', ada)
const boss = people[1]
check(boss.actions === 0 && boss.signIns === 1 && boss.appOpens === 1, 'signing out is not an action', boss)
check(boss.lastDevice === 'Chrome 128 on Windows 10/11' && boss.lastPlatform === 'web', 'a later row with no device keeps the last one known', boss)

const s = summarise(rows)
check(s.people === 2 && s.signIns === 2 && s.appOpens === 2 && s.actions === 3, 'summary cards', s)
check(s.mostActive?.name === 'Ada Okafor' && s.mostActive.count === 5, 'most active person', s.mostActive)
const empty = summarise([])
check(empty.people === 0 && empty.mostActive === null, 'an empty day has nobody most active')

// ---- Links ----
const links = personLinks(ADA, '2026-10-20', '2026-10-22')
check(links.movement === `/admin/tracking?person=${ADA}&date=2026-10-20&until=2026-10-22`, 'movement over the same days', links.movement)
check(links.attendance === `/admin/attendance?user_id=${ADA}&from=2026-10-20&to=2026-10-22`, 'attendance over the same days', links.attendance)
check(personLinks(ADA, today, today).movement === `/admin/tracking?person=${ADA}&date=${today}`, 'one day needs no end date')

// ---- Downloads ----
const exported = activityExportRows(rows)
check(exported.length === rows.length && exported.every((r) => r.values.length === ACTIVITY_COLUMNS.length), 'one export row per entry, every column filled in')
check(
  JSON.stringify(exported[0].values.slice(1)) ===
    JSON.stringify(['Ada Okafor', 'Merchandiser', 'Clocked out at Ikeja City Mall', 'on site · 12 m from the store', 'Android app', 'Xtend app on Android 14', '']),
  'an export row: person, role, what, detail, platform, device, IP',
  exported[0].values,
)
check(/17:05/.test(exported[0].values[0]), 'times in the download are Lagos time', exported[0].values[0])
const sheet = activitySheet(rows, parseActivityFilter({ from: '2026-10-21', to: '2026-10-22', person: ADA, group: 'clock' }, today), [
  { id: ADA, full_name: 'Ada Okafor' },
])
check(sheet.title === 'Activity log' && sheet.fileBase === 'xtend-activity-log', 'the download is named for the activity log')
check(sheet.subtitle.includes('Ada Okafor') && sheet.subtitle.includes('Clocking in and out') && sheet.subtitle.includes('8 entries'), 'the subtitle says who, what and how many', sheet.subtitle)
check(sheet.widths.xlsx.length === ACTIVITY_COLUMNS.length && sheet.widths.pdf.length === ACTIVITY_COLUMNS.length, 'a width for every column')
check(/2 people were active/.test(sheet.notes ?? ''), 'the notes summarise the range', sheet.notes)
check(!/locat|integrity|track/i.test(JSON.stringify(sheet)), 'nothing about tracking or integrity leaks into the download')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL ACTIVITY CHECKS PASSED')
