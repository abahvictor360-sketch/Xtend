/**
 * Checks the clock-out reminder timing and wording (src/lib/clock-out-reminder.ts):
 * nothing before the shift end, the first at it, the second an hour later,
 * nothing once clocked out or after midnight Lagos, and the 18:00 default.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-clock-out-reminder.ts
 */
import {
  clockOutDue,
  dayEndAt,
  msUntilClockOutDue,
  reminderDue,
  reminderMessage,
  shiftEndAt,
  shiftEndLabel,
  type ReminderState,
} from '@/lib/clock-out-reminder'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const T = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 1, m) // Lagos h:m on 2026-10-<day>
const onShift: ReminderState = { date: '2026-10-16', shiftEnd: '17:00:00', clockedIn: true, clockedOut: false }
const noStore: ReminderState = { ...onShift, shiftEnd: null }

check(shiftEndLabel('17:00:00') === '17:00' && shiftEndLabel('9:30') === '09:30', 'shift end reads as HH:MM')
check(shiftEndLabel(null) === '18:00' && shiftEndLabel('') === '18:00' && shiftEndLabel('25:00') === '18:00',
  'no store, or a broken time, means 18:00')
check(shiftEndAt('2026-10-16', '17:00') === T(16, 17), 'the shift end is Lagos time (UTC+1)', new Date(shiftEndAt('2026-10-16', '17:00')))
check(dayEndAt('2026-10-16') === T(17, 0), 'the day ends at midnight Lagos')

check(!clockOutDue(onShift, T(16, 16, 59)), 'not due a minute before the shift ends')
check(clockOutDue(onShift, T(16, 17)), 'due at the shift end')
check(clockOutDue(onShift, T(16, 23, 59)), 'still due late in the evening')
check(!clockOutDue(onShift, T(17, 0, 1)), 'never after midnight Lagos')
check(!clockOutDue({ ...onShift, clockedOut: true }, T(16, 18)), 'never once clocked out')
check(!clockOutDue({ ...onShift, clockedIn: false }, T(16, 18)), 'never for someone not clocked in')
check(!clockOutDue(noStore, T(16, 17, 30)) && clockOutDue(noStore, T(16, 18)), 'someone with no store is asked at 18:00')

check(msUntilClockOutDue(onShift, T(16, 16, 30)) === 30 * 60_000, 'an open app knows how long until the prompt')
check(msUntilClockOutDue(onShift, T(16, 17, 1)) === null, 'and does not wait once it is due')
check(msUntilClockOutDue({ ...onShift, clockedOut: true }, T(16, 12)) === null, 'nor once clocked out')

check(reminderDue(onShift, T(16, 16, 55)) === null, 'no reminder before the shift end')
check(reminderDue(onShift, T(16, 17)) === 1, 'the first reminder at the shift end')
check(reminderDue(onShift, T(16, 17, 5), [1]) === null, 'the first only once')
check(reminderDue(onShift, T(16, 17, 59), [1]) === null, 'the second not before an hour')
check(reminderDue(onShift, T(16, 18), [1]) === 2, 'the second an hour after the shift end')
check(reminderDue(onShift, T(16, 19), [1, 2]) === null, 'never more than two')
check(reminderDue(onShift, T(16, 18, 30), []) === 2, 'a late job sends only the second, not both')
check(reminderDue(onShift, T(16, 18, 35), [2]) === null, 'and never the first after the second')
check(reminderDue({ ...onShift, clockedOut: true }, T(16, 18), [1]) === null, 'no reminder after clocking out')
check(reminderDue(onShift, T(17, 0, 30), [1]) === null, 'no reminder after midnight Lagos')

const first = reminderMessage(1, '17:00:00')
check(first.title === 'Time to clock out' && first.body === 'Your shift ended at 17:00. Clock out with a selfie before you leave.'
  && first.url === '/field', 'the first reminder says when the shift ended and opens the app', first)
const second = reminderMessage(2, null)
check(second.title === 'You have not clocked out yet' && second.body.includes('18:00') && second.url === '/field',
  'the second reminder says they have not clocked out yet', second)
const words = `${first.title} ${first.body} ${second.title} ${second.body}`.toLowerCase()
check(!/location|track|monitor|alert|supervisor|gps/.test(words), 'the reminders say nothing about monitoring')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL CLOCK-OUT REMINDER CHECKS PASSED')
