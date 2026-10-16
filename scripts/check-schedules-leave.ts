/**
 * Checks work schedules and leave (src/lib/schedule.ts), which mirror
 * public.day_kind() and apply_leave() in migration 059: the default week,
 * patterns, one-off changes, approved leave, the leave form's date rules,
 * the order of the Leave page, and how the staff calendars mark each day.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-schedules-leave.ts
 */
import {
  DEFAULT_SCHEDULE,
  calendarMark,
  cleanDays,
  daysInclusive,
  dow,
  isMissed,
  leaveDateProblem,
  leaveRangeText,
  makeSchedule,
  monthEnd,
  monthWeeks,
  overlaps,
  patternText,
  samePattern,
  shiftMonth,
  shortDay,
  sortLeave,
  type LeaveRow,
} from '@/lib/schedule'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

// Week of Monday 12 Oct 2026 to Sunday 18 Oct; "today" is Friday 16 Oct.
const today = '2026-10-16'
check(dow('2026-10-12') === 1 && dow('2026-10-18') === 0, 'days of the week as Postgres numbers them')

// The default week.
const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
check(
  week.map((d) => DEFAULT_SCHEDULE.kind('anyone', d)).join(',') === 'working,working,working,working,working,working,off',
  'nobody given a pattern works Monday to Saturday',
  week.map((d) => DEFAULT_SCHEDULE.kind('anyone', d)),
)

// Patterns, changes and leave, in that order of strength.
const book = makeSchedule(
  [
    { user_id: 'ada', days: [1, 2, 3, 4, 5] },
    { user_id: 'sunday', days: [0, 3, 4, 5, 6] },
  ],
  [
    { user_id: 'ada', day: '2026-10-17', working: true },
    { user_id: 'ada', day: '2026-10-14', working: false },
    { user_id: 'bola', day: '2026-10-13', working: false },
  ],
  [
    { user_id: 'ada', from_date: '2026-10-15', to_date: '2026-10-16', status: 'approved' },
    { user_id: 'ada', from_date: '2026-10-12', to_date: '2026-10-12', status: 'pending' },
    { user_id: 'bola', from_date: '2026-10-12', to_date: '2026-10-12', status: 'rejected' },
    { user_id: 'bola', from_date: '2026-10-14', to_date: '2026-10-14', status: 'cancelled' },
    { user_id: 'sunday', from_date: '2026-10-17', to_date: '2026-10-19', status: 'approved' },
  ],
)
check(book.kind('ada', '2026-10-12') === 'working', 'leave still waiting does not change the day')
check(book.kind('ada', '2026-10-14') === 'off', 'a one-off day off beats the pattern')
check(book.kind('ada', '2026-10-15') === 'leave' && book.kind('ada', '2026-10-16') === 'leave', 'approved leave covers each of its days')
check(book.kind('ada', '2026-10-17') === 'working', 'a one-off day in makes a Saturday off a working day')
check(book.kind('ada', '2026-10-18') === 'off', 'Sunday off on a Monday-to-Friday pattern')
check(book.kind('bola', '2026-10-12') === 'working' && book.kind('bola', '2026-10-14') === 'working', 'rejected and cancelled leave change nothing')
check(book.kind('bola', '2026-10-13') === 'off', 'a one-off day off for someone on the usual week')
check(book.kind('sunday', '2026-10-18') === 'leave' && book.kind('sunday', '2026-10-20') === 'off', 'leave beats the pattern; Tuesday is off for a Wed-Sun worker')
check(book.kind('sunday', '2026-10-21') === 'working', 'and Wednesday is a working day')
check(book.hasPattern('ada') && !book.hasPattern('bola'), 'knows who has their own pattern')
check(samePattern(book.pattern('bola'), [1, 2, 3, 4, 5, 6]), 'the usual week when none is set', book.pattern('bola'))

// Patterns in words.
check(cleanDays([5, 1, 1, 9, -1, 3]).join(',') === '1,3,5', 'patterns are cleaned: 0-6, once each, in order')
check(patternText([1, 2, 3, 4, 5, 6]) === 'Mon–Sat', 'Monday to Saturday reads Mon–Sat', patternText([1, 2, 3, 4, 5, 6]))
check(patternText([1, 2, 3, 4, 5]) === 'Mon–Fri', 'Mon–Fri')
check(patternText([0, 1, 2, 3, 4, 5, 6]) === 'Every day' && patternText([]) === 'No working days', 'every day and no days')
check(patternText([1, 3, 5]) === 'Mon, Wed, Fri', 'separate days are listed', patternText([1, 3, 5]))
check(patternText([0, 3, 4, 5, 6]) === 'Wed–Sun', 'a week that runs into Sunday', patternText([0, 3, 4, 5, 6]))
check(patternText([1, 2, 6]) === 'Mon, Tue, Sat', 'two days are not a range', patternText([1, 2, 6]))

// The leave form says what apply_leave() would refuse.
const mine: Pick<LeaveRow, 'from_date' | 'to_date' | 'status'>[] = [
  { from_date: '2026-10-20', to_date: '2026-10-22', status: 'pending' },
  { from_date: '2026-11-02', to_date: '2026-11-02', status: 'approved' },
  { from_date: '2026-11-10', to_date: '2026-11-12', status: 'rejected' },
  { from_date: '2026-11-20', to_date: '2026-11-20', status: 'cancelled' },
]
check(leaveDateProblem('2026-10-19', '2026-10-19', today, mine) === null, 'free dates are fine')
check(leaveDateProblem('2026-10-09', '2026-10-09', today) === null, 'exactly 7 days back is allowed')
check(leaveDateProblem('2026-10-08', '2026-10-09', today)?.includes('7 days ago') === true, 'more than 7 days back is refused')
check(leaveDateProblem('2026-10-21', '2026-10-20', today)?.includes('before the first day') === true, 'dates the wrong way round')
check(leaveDateProblem('2026-10-19', '2026-10-20', today, mine)?.includes('already have leave') === true, 'touching a pending request is an overlap')
check(leaveDateProblem('2026-11-01', '2026-11-03', today, mine)?.includes('already have leave') === true, 'covering approved leave is an overlap')
check(leaveDateProblem('2026-11-10', '2026-11-20', today, mine) === null, 'rejected and cancelled requests do not block')
check(leaveDateProblem('2026-12-01', '2027-02-01', today)?.includes('60 days') === true, 'one request covers at most 60 days')
check(leaveDateProblem('2027-10-20', '2027-10-20', today)?.includes('next year') === true, 'not more than a year ahead')
check(leaveDateProblem('', '2026-10-20', today) !== null, 'both dates are needed')
check(overlaps({ from: '2026-10-01', to: '2026-10-05' }, { from: '2026-10-05', to: '2026-10-09' }), 'sharing one day is an overlap')
check(!overlaps({ from: '2026-10-01', to: '2026-10-04' }, { from: '2026-10-05', to: '2026-10-09' }), 'back to back is not')
check(daysInclusive('2026-10-20', '2026-10-22') === 3 && daysInclusive('2026-10-20', '2026-10-20') === 1, 'both ends count')
check(leaveRangeText('2026-10-20', '2026-10-22') === 'Tue 20 Oct to Thu 22 Oct (3 days)', 'a range in words', leaveRangeText('2026-10-20', '2026-10-22'))
check(leaveRangeText('2026-10-20', '2026-10-20') === 'Tue 20 Oct (1 day)' && shortDay('2026-10-18') === 'Sun 18 Oct', 'one day in words')

// The Leave page: waiting first (soonest first), then the rest newest first.
const sorted = sortLeave([
  { status: 'approved', from_date: '2026-10-01', created_at: '2026-09-20T10:00:00Z' },
  { status: 'pending', from_date: '2026-11-05', created_at: '2026-10-10T10:00:00Z' },
  { status: 'rejected', from_date: '2026-10-25', created_at: '2026-10-01T10:00:00Z' },
  { status: 'pending', from_date: '2026-10-20', created_at: '2026-10-12T10:00:00Z' },
])
check(
  sorted.map((r) => `${r.status}:${r.from_date}`).join(' ') ===
    'pending:2026-10-20 pending:2026-11-05 rejected:2026-10-25 approved:2026-10-01',
  'pending first, soonest first; then the rest, newest first',
  sorted,
)

// Staff calendars: the same verdict my_calendar() gives.
const since = '2026-10-13'
check(isMissed('working', '2026-10-15', today, since, false), 'a past working day without a clock-in is missed')
check(!isMissed('working', today, today, since, false), 'today is never missed yet')
check(!isMissed('working', '2026-10-12', today, since, false), 'nothing is missed before the account was made')
check(!isMissed('off', '2026-10-14', today, since, false) && !isMissed('leave', '2026-10-14', today, since, false), 'days off and leave are never missed')
check(!isMissed('working', '2026-10-15', today, since, true), 'a day with a clock-in is not missed')
check(calendarMark({ day: '2026-10-15', kind: 'working', clocked_in: false, missed: true }) === 'missed', 'missed shows red')
check(calendarMark({ day: '2026-10-18', kind: 'off', clocked_in: false, missed: false }) === 'off', 'a day off shows grey')
check(calendarMark({ day: '2026-10-14', kind: 'leave', clocked_in: false, missed: false }) === 'leave', 'leave shows as leave')
check(calendarMark({ day: '2026-10-18', kind: 'off', clocked_in: true, missed: false }) === 'worked', 'coming in on a day off shows as worked')
check(calendarMark({ day: today, kind: 'working', clocked_in: false, missed: false }) === 'plain' && calendarMark(undefined) === 'plain', 'today and unknown days are plain')

// The month grid, Monday first.
const oct = monthWeeks('2026-10-16')
check(oct.length === 5 && oct[0].slice(0, 3).every((d) => d === null) && oct[0][3] === '2026-10-01', 'October 2026 starts on a Thursday', oct[0])
check(oct.every((w) => w.length === 7) && oct[4][5] === '2026-10-31' && oct[4][6] === null, 'every week has seven cells, ending on the 31st', oct[4])
const feb = monthWeeks('2027-02-01')
check(feb.length === 4 && feb[0][0] === '2027-02-01' && feb[3][6] === '2027-02-28', 'February 2027 fills four weeks exactly', feb)
check(shiftMonth('2026-12-15', 1) === '2027-01-01' && shiftMonth('2026-01-31', -1) === '2025-12-01', 'months move across years')
check(monthEnd('2028-02-10') === '2028-02-29' && monthEnd('2026-10-16') === '2026-10-31', 'month ends, leap years too')

console.log(failed ? `\n${failed} FAILED` : '\nALL SCHEDULE AND LEAVE CHECKS PASSED')
process.exit(failed ? 1 : 0)
