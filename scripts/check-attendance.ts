import { attendanceWriteUp } from '../src/lib/attendance-writeup'
import { initialsOf, personPinHtml } from '../src/components/admin/attendance-map'
import { attendanceReportModel } from '../src/lib/attendance-report-model'
/**
 * Checks how clock events become attendance days (src/lib/attendance-report.ts):
 * on time, late, off site, absent, days off and leave, no clock-out, the summary
 * figures, patterns worth a look, grouping, trends and store coverage.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-attendance.ts
 */
import {
  buildDays,
  byHour,
  byWeekday,
  cleanRange,
  clock,
  concerns,
  dayCount,
  dayList,
  delta,
  deviceText,
  group,
  inDayTable,
  leaders,
  matchesStatus,
  minutesOf,
  presets,
  previousPeriod,
  sortDays,
  storeCoverage,
  summarise,
  trend,
  type ClockEvent,
  type Person,
} from '@/lib/attendance-report'
import { makeSchedule } from '@/lib/schedule'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

// Lagos is UTC+1 all year.
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+01:00`).toISOString()
let n = 0
function ev(
  user: string,
  date: string,
  hm: string,
  type: 'opening' | 'closing' = 'opening',
  extra: Partial<ClockEvent> = {},
): ClockEvent {
  const shift = extra.shift_start === undefined ? '08:00:00' : extra.shift_start
  return {
    id: `e${++n}`,
    user_id: user,
    attendance_date: date,
    type,
    created_at: at(date, hm),
    local_time: `${date} ${hm}`,
    outlet_id: 'mall',
    outlet_name: 'Ikeja City Mall',
    shift_start: shift,
    status: 'on_site',
    distance_m: 20,
    is_late: type === 'opening' && shift !== null && hm > shift.slice(0, 5),
    client_captured_at: at(date, hm),
    ...extra,
  }
}
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  phone: null,
  role: 'merchandiser',
  roleLabel: 'Merchandiser',
  roleValue: 'merchandiser',
  outletId: 'mall',
  outletName: 'Ikeja City Mall',
  teamId: 'sup1',
  teamName: 'Bola',
  active: true,
  since: '2026-01-01',
  ...extra,
})

// Week of Monday 5 Oct 2026 to Sunday 11 Oct; "today" is Thursday 8 Oct.
const today = '2026-10-08'
const days = dayList('2026-10-05', '2026-10-11')
check(days.length === 7 && days[6] === '2026-10-11', 'seven days listed', days)

const ada = person('ada', 'Ada Okafor')
const tunde = person('tunde', 'Tunde Bakare', { outletId: 'leki', outletName: 'Leki Mart', teamId: 'sup2', teamName: 'Chidi' })
const new1 = person('new', 'New Starter', { since: '2026-10-07' })
const gone = person('gone', 'Gone Person', { active: false })
const people = [ada, tunde, new1, gone]

const events: ClockEvent[] = [
  // Ada: Mon on time and out, Tue late 25 min and no clock-out, Wed off site and out, Thu (today) in, not out yet.
  ev('ada', '2026-10-05', '07:55'),
  ev('ada', '2026-10-05', '17:10', 'closing'),
  ev('ada', '2026-10-06', '08:25'),
  ev('ada', '2026-10-07', '07:50', 'opening', { status: 'off_site', distance_m: 2400 }),
  ev('ada', '2026-10-07', '16:00', 'closing'),
  ev('ada', '2026-10-08', '07:58'),
  // A second clock-in the same day does not replace the first.
  ev('ada', '2026-10-08', '09:30'),
  // Tunde: Mon in at Leki, captured at 07:40 but reached the server at 08:30 (offline), then absent Tue-Thu.
  ev('tunde', '2026-10-05', '08:30', 'opening', {
    outlet_id: 'leki',
    outlet_name: 'Leki Mart',
    is_late: false,
    client_captured_at: at('2026-10-05', '07:40'),
    local_time: '2026-10-05 07:40',
    created_at: at('2026-10-05', '08:30'),
  }),
  ev('tunde', '2026-10-05', '18:00', 'closing', { outlet_id: 'leki', outlet_name: 'Leki Mart' }),
  // Flagged clock-in for the new starter on her second day.
  ev('new', '2026-10-08', '07:59', 'opening', { status: 'flagged' }),
  // Somebody not in scope: ignored.
  ev('stranger', '2026-10-05', '08:00'),
]

const records = buildDays(people, events, days, { today })
const rec = (u: string, d: string) => records.find((r) => r.userId === u && r.date === d)!
check(records.length === people.length * days.length, 'a record for every person and day', records.length)

const mon = rec('ada', '2026-10-05')
check(mon.status === 'on_time' && mon.hours !== null && Math.abs(mon.hours - (9 + 15 / 60)) < 0.01, 'Monday: on time, 9 h 15 min on shift', mon)
const tue = rec('ada', '2026-10-06')
check(tue.status === 'late' && tue.minutesLate === 25 && tue.missingOut, 'Tuesday: 25 min late and never clocked out', tue)
const wed = rec('ada', '2026-10-07')
check(wed.status === 'off_site' && wed.offSite && !wed.flagged && !wed.missingOut, 'Wednesday: off site, clocked out', wed)
const thu = rec('ada', today)
check(thu.status === 'on_time' && thu.onShift && !thu.missingOut, 'today: still on shift is not a missing clock-out', thu)
check(thu.clockIn?.local_time.endsWith('07:58') === true, 'the first clock-in of the day counts', thu.clockIn)
check(rec('ada', '2026-10-09').status === 'none', 'days after today are not absences', rec('ada', '2026-10-09').status)

const tMon = rec('tunde', '2026-10-05')
check(tMon.status === 'on_time' && tMon.sentLateMin === 50, 'an offline clock-in: on time by the photo, sent 50 min later', tMon)
check(tMon.outletName === 'Leki Mart', 'the day is at the store of the clock-in', tMon.outletName)
check(['2026-10-06', '2026-10-07', today].every((d) => rec('tunde', d).status === 'absent'), 'Tuesday to today without a clock-in: absent')
check(rec('tunde', '2026-10-06').outletName === 'Leki Mart', 'an absence sits at their own store', rec('tunde', '2026-10-06').outletName)

check(rec('new', '2026-10-06').status === 'none', 'no absence before someone joined', rec('new', '2026-10-06').status)
check(rec('new', '2026-10-07').status === 'absent', 'absent on their first day', rec('new', '2026-10-07').status)
const flagged = rec('new', today)
check(flagged.status === 'off_site' && flagged.flagged, 'a flagged clock-in reads as off site and flagged', flagged)
check(rec('gone', '2026-10-06').status === 'none', 'a switched-off person is never absent', rec('gone', '2026-10-06').status)

// Schedules (migration 059): Sunday is off for anyone without a pattern;
// someone who works Sundays is absent then; days off and leave never are.
const sundayOff = buildDays([ada], [], ['2026-10-04'], { today })[0]
const sundayWorker = makeSchedule([{ user_id: 'ada', days: [0, 1, 2, 3, 4] }])
const sundayOn = buildDays([ada], [], ['2026-10-04', '2026-10-03'], { today, schedule: sundayWorker })
check(sundayOff.status === 'off' && sundayOn[0].status === 'absent' && sundayOn[1].status === 'off',
  'Sunday off by default; a Sunday worker is absent on Sunday and off on Saturday', [sundayOff.status, sundayOn.map((r) => r.status)])
const onLeave = buildDays([ada], [], ['2026-10-06', '2026-10-07'], {
  today,
  schedule: makeSchedule([], [{ user_id: 'ada', day: '2026-10-07', working: false }], [
    { user_id: 'ada', from_date: '2026-10-06', to_date: '2026-10-06', status: 'approved' },
  ]),
})
check(onLeave[0].status === 'leave' && onLeave[1].status === 'off', 'approved leave and a day changed to off are not absences', onLeave.map((r) => r.status))
check(summarise(onLeave).expected === 0 && !matchesStatus(onLeave[0], null) && matchesStatus(onLeave[0], 'leave'),
  'leave is not an expected day, but the leave filter finds it')
check(inDayTable(onLeave[0], null, false) && !inDayTable(onLeave[1], null, false) && inDayTable(onLeave[1], null, true),
  'the day table lists leave, and days off only for one person')
const pendingLeave = buildDays([ada], [], ['2026-10-06'], {
  today,
  schedule: makeSchedule([], [], [{ user_id: 'ada', from_date: '2026-10-06', to_date: '2026-10-06', status: 'pending' }]),
})[0]
check(pendingLeave.status === 'absent', 'leave still waiting does not excuse the day', pendingLeave.status)
const sundayIn = buildDays([ada], [ev('ada', '2026-10-04', '09:00', 'opening', { shift_start: null, is_late: false })], ['2026-10-04'], { today })[0]
check(sundayIn.present && sundayIn.status === 'on_time' && sundayIn.minutesLate === null, 'coming in on a Sunday still counts, with no shift start no lateness', sundayIn)

// Summary.
const s = summarise(records)
// Present: ada Mon Tue Wed Thu, tunde Mon, new Thu = 6. Absent: tunde Tue Wed Thu, new Wed = 4.
check(s.present === 6 && s.absent === 4 && s.expected === 10, 'six days present, four absent', s)
check(s.late === 1 && s.onTime === 5 && s.offSite === 2 && s.flagged === 1 && s.missingOut === 1, 'one late, two off site (one flagged), one missing clock-out', s)
check(s.punctuality !== null && Math.round(s.punctuality) === 83 && s.turnout === 60, 'punctuality 83%, turnout 60%', [s.punctuality, s.turnout])
check(s.people === 3, 'three people counted (the switched-off one has no days)', s.people)
check(summarise([]).punctuality === null, 'nothing to judge: no percentage', summarise([]))

// Status filter.
check(records.filter((r) => matchesStatus(r, 'absent')).length === 4, 'absent filter', records.filter((r) => matchesStatus(r, 'absent')).length)
check(records.filter((r) => matchesStatus(r, 'missing_out')).length === 1, 'no clock-out filter')
// "Who" filters (2026-11-19): clocked in, clocked out, still on shift.
const came = records.filter((r) => matchesStatus(r, 'present'))
const out = records.filter((r) => matchesStatus(r, 'clocked_out'))
const onShiftNow = records.filter((r) => matchesStatus(r, 'on_shift'))
check(came.length > 0 && came.every((r) => r.present), 'clocked in: only those who came')
check(out.every((r) => r.present && r.clockOut) && out.length === came.filter((r) => r.clockOut).length, 'clocked out: those who came and clocked out')
check(onShiftNow.every((r) => r.onShift) && onShiftNow.length === records.filter((r) => r.onShift).length, 'still on shift: clocked in today, not out yet')
check(out.length + onShiftNow.length + came.filter((r) => r.missingOut).length === came.length, 'everyone who came is clocked out, on shift, or missing a clock-out')
check(records.filter((r) => matchesStatus(r, 'on_time')).length === 3, 'on time filter leaves out off site days')
check(records.filter((r) => matchesStatus(r, null)).length === 10, 'no filter: every day that counts')

// Sorting.
const names = new Map(people.map((p) => [p.id, p.name]))
const real = records.filter((r) => matchesStatus(r, null))
const byLate = sortDays(real, names, 'late', 'desc')
check(byLate[0].key === 'ada|2026-10-06', 'latest arrival first when sorted by lateness', byLate[0].key)
check(byLate[byLate.length - 1].status === 'absent', 'absences (no time) sort last', byLate[byLate.length - 1].status)
const byName = sortDays(real, names, 'name', 'asc')
check(byName[0].userId === 'ada' && byName[0].date === today, 'by name, then newest day', byName[0].key)
// The default order: newest day first; within a day, everyone who clocked
// in (latest clock-in first) above everyone who did not.
const byDate = sortDays(real, names, 'date', 'desc')
check(byDate.every((r, i) => i === 0 || byDate[i - 1].date >= r.date), 'default order: newest day first')
for (const day of new Set(byDate.map((r) => r.date))) {
  const rows = byDate.filter((r) => r.date === day)
  const firstAbsent = rows.findIndex((r) => !r.present)
  check(firstAbsent === -1 || rows.slice(firstAbsent).every((r) => !r.present), `${day}: everyone who clocked in comes before those who did not`)
  const ins = rows.filter((r) => r.present).map((r) => r.inMinutes ?? -1)
  check(ins.every((m, i) => i === 0 || ins[i - 1] >= m), `${day}: latest clock-in first`)
}
check(/sortDays\(rows, names, 'date', 'desc'\)/.test(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'export', 'attendance-days.ts'), 'utf8')),
  'the day-by-day download uses the same order: clocked in first, absent after')
{
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  check(/\['merchandiser', BASE_LABEL\.merchandiser\],\s*\['marketer', BASE_LABEL\.marketer\]/.test(src('src/lib/attendance-server.ts')),
    'the Role filter always offers merchandisers and marketers')
  const filters = src('src/components/admin/attendance-filters.tsx')
  check(/choices\.roles\.length > 0/.test(filters) && /label: 'Merchandisers'/.test(filters) && /label: 'Marketers'/.test(filters),
    'Attendance shows the Role picker and the Role: All · Merchandisers · Marketers buttons')
  check(/roleHref=\{\(role\) => `\?\$\{reportQuery\(\{ \.\.\.filter, role \}\)\}#days`\}/.test(src('src/app/admin/attendance/page.tsx')),
    'the role buttons keep the rest of the view, so the export follows them')
}
// The written account at the top of the report (2026-11-19).
{
  const story = attendanceWriteUp(records, people, { from: days[0], to: days[days.length - 1] })
  const absentRows = records.filter((r) => r.status === 'absent')
  check(story[0].startsWith('## How ') && story.some((l) => /clocked in \(/.test(l)), 'the write-up opens with how the days went')
  const people_ = (rows: { userId: string }[]) => (days.length > 1 ? new Set(rows.map((r) => r.userId)).size : rows.length)
  check(!absentRows.length || story.includes(`## Did not clock in (${people_(absentRows)})`), 'it names everyone who did not clock in')
  const lateRows = records.filter((r) => r.present && r.late)
  check(!lateRows.length || story.includes(`## Late (${people_(lateRows)})`), 'it names who was late')
  const away = records.filter((r) => r.present && r.offSite)
  check(!away.length || story.includes(`## Clocked in away from their store (${people_(away)})`), 'it names who clocked in away from their store')
  const noOut = records.filter((r) => r.missingOut)
  check(!noOut.length || story.includes(`## Did not clock out (${people_(noOut)})`), 'it names who did not clock out')
  check(story.filter((l) => l.startsWith('• ')).every((l) => people.some((p) => l.includes(p.name)) || /more: see the table/.test(l) || !/—/.test(l)),
    'every point names a person')
  check(!story.join(' ').match(/\b(track|monitor)\w*/i), 'plain words, nothing about how staff are followed')
}
// The designed report's figures and charts (2026-11-19).
{
  const model = attendanceReportModel(real, records, people, { from: days[0], to: days[days.length - 1] }, 'test')
  const sum = summarise(records)
  check(model.kpis.length === 8 && model.kpis[0].value === String(sum.present), 'eight figures, "came in" first')
  const mixTotal = model.mix.reduce((t, x) => t + x.value, 0)
  check(mixTotal === sum.present + sum.absent + records.filter((r) => !r.present && (r.status === 'leave' || r.status === 'off')).length,
    'the ring adds up to everyone in the report')
  check(model.bars.every((b) => b.value >= 0 && b.value <= 100) && model.bars.length === new Set(records.map((r) => r.date)).size,
    'several days: one turnout bar per day, as a share')
  check(model.rows.length === real.length && model.rows.every((r) => r.name), 'the table has every row, each with a name')
  const grouped = model.story.sections.find((x) => x.key === 'late')
  check(!grouped || new Set(grouped.items.map((i) => i.name)).size === grouped.items.length, 'over several days, each person once per list')
  check(!grouped || grouped.items.every((i) => /\d+ days?/.test(i.day ?? '')), 'with how many days')
  const one = days[days.length - 1]
  const dayRecs = records.filter((r) => r.date === one)
  const dayModel = attendanceReportModel(dayRecs, dayRecs, people, { from: one, to: one }, 'test')
  const inCount = dayRecs.filter((r) => r.present).length
  check(dayModel.bars.reduce((t, b) => t + b.value, 0) === inCount, 'one day: the clock-in time slots hold everyone who clocked in')
}
check(new Set(byDate.map((r) => r.date)).size > 0 && byDate.some((r) => !r.present) && byDate.some((r) => r.present), 'the sample has both clocked-in and not-clocked-in days')

// Worth a look.
const worry = concerns(records, people)
const tundeAbsent = worry.find((c) => c.userId === 'tunde' && c.kind === 'absent')
check(tundeAbsent?.count === 3 && tundeAbsent.dates[0] === '2026-10-06', 'Tunde: three absences called out', worry)
check(worry[0].kind === 'absent', 'absences come first', worry[0])
check(!worry.some((c) => c.kind === 'late'), 'one late day is not a pattern', worry)
const lateWeek = buildDays(
  [ada],
  ['2026-10-05', '2026-10-06', '2026-10-07'].map((d, i) => ev('ada', d, ['08:10', '08:20', '08:30'][i])),
  dayList('2026-10-05', '2026-10-07'),
  { today },
)
const lateC = concerns(lateWeek, [ada]).filter((c) => c.kind === 'late')
check(lateC.length === 1 && lateC[0].text.includes('3 days') && lateC[0].text.includes('20 min'), 'three late days, 20 min on average', lateC)

// Grouping.
const byStore = group(records, people, 'store')
const mall = byStore.find((g) => g.key === 'mall')!
const leki = byStore.find((g) => g.key === 'leki')!
check(mall.present === 5 && mall.absent === 1 && leki.present === 1 && leki.absent === 3, 'per store: mall 5 in 1 absent, Leki 1 in 3 absent', byStore)
const byTeam = group(records, people, 'team')
check(byTeam.length === 2 && byTeam.find((g) => g.key === 'sup2')?.label === 'Chidi', 'per team, named by supervisor', byTeam)
const top = leaders(group(records, people, 'person'), (r) => r.absent)
check(top[0].key === 'tunde' && top.length === 2, 'most absences: Tunde first, nobody with none', top)
const worst = leaders(group(records, people, 'person'), (r) => r.punctuality, 5, true)
check(worst[0].key === 'ada', 'least on time first when asked for the lowest', worst)

// Trend, weekdays, hours.
const t = trend(records, days)
check(t.length === 7 && t[0].onTime === 2 && t[1].late === 1 && t[1].absent === 1, 'one bar a day', t.slice(0, 2))
const weekly = trend([], dayList('2026-08-01', '2026-10-08'))
check(weekly.length === 11 && weekly[0].date === '2026-07-27', 'long ranges go week by week, from Monday', [weekly.length, weekly[0].date])
const wd = byWeekday(records)
check(wd[0].label === 'Mon' && wd[0].present === 2 && wd[6].label === 'Sun', 'weekdays Monday first', wd[0])
const hours = byHour(records)
check(hours[0].hour === 6 && hours.find((h) => h.hour === 7)!.onTime === 5 && hours.find((h) => h.hour === 8)!.late === 1, 'clock-ins by hour', hours)

// Store coverage: working days up to today Mon-Thu = 4.
const cover = storeCoverage(records, people, days, { today })
const lekiC = cover.find((c) => c.id === 'leki')!
const mallC = cover.find((c) => c.id === 'mall')!
check(lekiC.workingDays === 4 && lekiC.covered === 1 && lekiC.gaps.length === 3, 'Leki covered 1 of 4 working days', lekiC)
check(mallC.covered === 4 && mallC.pct === 100 && mallC.people === 2, 'the mall every day, two people (switched-off one not counted)', mallC)
check(cover[0].id === 'leki', 'least covered store first', cover[0].id)
// Tunde (Leki's only person) works Monday and Tuesday only: two working days there.
const coverShort = storeCoverage(records, people, days, { today, schedule: makeSchedule([{ user_id: 'tunde', days: [1, 2] }]) })
const lekiShort = coverShort.find((c) => c.id === 'leki')!
check(lekiShort.workingDays === 2 && lekiShort.covered === 1 && lekiShort.gaps[0] === '2026-10-06', 'a store counts only the days its people are expected', lekiShort)

// Ranges and presets.
check(dayCount('2026-10-01', '2026-10-31') === 31, 'October has 31 days')
const prev = previousPeriod('2026-10-01', '2026-10-07')
check(prev.from === '2026-09-24' && prev.to === '2026-09-30', 'the week before', prev)
const p = Object.fromEntries(presets(today, ['week', 'month', 'last_month', '7d', 'yesterday']).map((x) => [x.key, x]))
check(p.week.from === '2026-10-05' && p.week.to === today, 'this week starts Monday', p.week)
check(p.month.from === '2026-10-01' && p.last_month.from === '2026-09-01' && p.last_month.to === '2026-09-30', 'this month and last month', [p.month, p.last_month])
check(p['7d'].from === '2026-10-02' && p.yesterday.to === '2026-10-07', 'last 7 days and yesterday', [p['7d'], p.yesterday])
const fb = { from: today, to: today }
check(JSON.stringify(cleanRange(null, null, today, fb, 92)) === JSON.stringify({ from: today, to: today, clipped: false }), 'no dates: the fallback')
check(cleanRange('2026-10-07', '2027-01-01', today, fb, 92).to === today, 'never past today')
check(cleanRange('2026-10-08', '2026-10-01', today, fb, 92).from === '2026-10-01', 'dates the wrong way round are swapped')
const long = cleanRange('2025-01-01', today, today, fb, 92)
check(long.clipped && dayCount(long.from, long.to) === 92, 'a long range is cut to 92 days, keeping the end', long)
check(cleanRange('2026-10-03', null, today, fb, 92).to === today, 'from alone runs to today')

// Small helpers.
check(minutesOf('2026-10-08 08:05') === 485 && minutesOf('08:00:00') === 480 && minutesOf(null) === null, 'minutes from times')
check(clock(485) === '08:05' && clock(null) === '—', 'times back from minutes')
check(delta(80, 70, true).better === true && delta(5, 3, false).better === false && delta(null, 3, true).change === null, 'deltas know which way is better')
check(deviceText({ ua: 'Mozilla/5.0 (Linux; Android 13; TECNO KG5 Build/TP1A) Chrome/120', native: { platform: 'android' } }) === 'TECNO KG5, Android 13 in the Xtend app', 'device named from the browser string', deviceText({ ua: 'Mozilla/5.0 (Linux; Android 13; TECNO KG5 Build/TP1A) Chrome/120', native: { platform: 'android' } }))
check(deviceText({}) === 'Not reported', 'no device info')

// The map's pins are the people: photo (or initials), ring, badge, name underneath.
{
  const pin = personPinHtml('Ada <Okafor>', 'https://x.test/a.jpg', true, 'in')
  check(pin.includes('<img src="https://x.test/a.jpg"') && pin.includes('#15803d') && pin.includes('>IN<') && pin.includes('Ada &lt;Okafor&gt;'),
    'a pin shows the photo, a green ring on site, IN, and the escaped name underneath')
  const none = personPinHtml('Tunde Bakare', null, false, 'out')
  check(none.includes('>TB<') && none.includes('#c2410c') && none.includes('>OUT<') && !none.includes('<img'), 'no photo: initials, orange off site, OUT')
  check(initialsOf('ada') === 'A' && initialsOf('  ') === '?', 'initials')
  const fs = require('node:fs') as typeof import('node:fs')
  const page = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/app/admin/attendance/page.tsx'), 'utf8')
  check(page.includes('avatarUrls(supabase,') && page.includes('photo: photos.get(p.id)'), 'the page signs the photos of the people listed, in the viewer’s own session')
}

console.log(failed ? `\n${failed} FAILED` : '\nALL ATTENDANCE CHECKS PASSED')
process.exit(failed ? 1 : 0)
