/**
 * Checks the five-minute heads-ups (src/lib/shift-reminder.ts, migration
 * 0069): "Time to clock in" in the five minutes before the shift starts,
 * "Your shift ends at" in the five minutes before it ends, never twice,
 * never once the time has passed, never on a day off or leave, never once
 * clocked in (or out), the 08:00 default, and the wording.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-shift-reminders.ts
 */
import {
  clockInSoon,
  clockOutSoon,
  msUntilSoonChange,
  shiftStartAt,
  shiftStartLabel,
  soonDue,
  soonMessage,
  type SoonState,
} from '@/lib/shift-reminder'
import { reminderDue } from '@/lib/clock-out-reminder'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const T = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 9, day, h - 1, m, s) // Lagos h:m on 2026-10-<day>
const before: SoonState = {
  date: '2026-10-27', shiftStart: '09:00:00', shiftEnd: '17:30:00', clockedIn: false, clockedOut: false, workingDay: true,
}
const onShift: SoonState = { ...before, clockedIn: true }
const noStore: SoonState = { ...before, shiftStart: null, shiftEnd: null }

// --- Times.
check(shiftStartLabel('09:00:00') === '09:00' && shiftStartLabel('7:45') === '07:45', 'the shift start reads as HH:MM')
check(shiftStartLabel(null) === '08:00' && shiftStartLabel('') === '08:00' && shiftStartLabel('24:10') === '08:00',
  'no store, or a broken time, means 08:00')
check(shiftStartAt('2026-10-27', '09:00') === T(27, 9), 'the shift start is Lagos time (UTC+1)')

// --- Clock in.
check(!clockInSoon(before, T(27, 8, 54, 59)), 'no clock-in heads-up more than five minutes before the start')
check(clockInSoon(before, T(27, 8, 55)), 'the clock-in heads-up at five minutes to the start')
check(clockInSoon(before, T(27, 8, 59, 59)), 'and up to the start')
check(!clockInSoon(before, T(27, 9)), 'not once the start has passed')
check(!clockInSoon({ ...before, clockedIn: true }, T(27, 8, 57)), 'not once clocked in')
check(!clockInSoon({ ...before, workingDay: false }, T(27, 8, 57)), 'not on a day off or leave')
check(clockInSoon(noStore, T(27, 7, 55)) && !clockInSoon(noStore, T(27, 8, 55)), 'someone with no store at 07:55')

// --- Clock out.
check(!clockOutSoon(onShift, T(27, 17, 24, 59)), 'no clock-out heads-up more than five minutes before the end')
check(clockOutSoon(onShift, T(27, 17, 25)) && clockOutSoon(onShift, T(27, 17, 29, 59)), 'the clock-out heads-up in the last five minutes')
check(!clockOutSoon(onShift, T(27, 17, 30)), 'not once the end has passed (the at-end reminder takes over)')
check(reminderDue({ date: onShift.date, shiftEnd: onShift.shiftEnd, clockedIn: true, clockedOut: false }, T(27, 17, 30)) === 1,
  'the at-end reminder still comes at the end')
check(!clockOutSoon(before, T(27, 17, 26)), 'not to someone not clocked in')
check(!clockOutSoon({ ...onShift, clockedOut: true }, T(27, 17, 26)), 'not once clocked out')
check(!clockOutSoon({ ...onShift, shiftEnd: '00:03' }, T(28, 0, 1)), 'never into the next day')

// --- The job: once each, never stale.
check(soonDue(before, T(27, 8, 55)) === 'clock_in_soon', 'the job sends the clock-in heads-up in its window')
check(soonDue(before, T(27, 8, 58), ['clock_in_soon']) === null, 'only once')
check(soonDue(before, T(27, 9, 2)) === null, 'a late job sends nothing after the start')
check(soonDue(onShift, T(27, 17, 25), ['clock_in_soon']) === 'clock_out_soon', 'the clock-out heads-up is a separate stage')
check(soonDue(onShift, T(27, 17, 28), ['clock_in_soon', 'clock_out_soon']) === null, 'and goes only once')
check(soonDue(onShift, T(27, 17, 31)) === null, 'a late job sends no stale clock-out heads-up')

// --- An open app wakes up when something changes.
check(msUntilSoonChange(before, T(27, 8, 50)) === 5 * 60_000, 'an open app knows when the clock-in card appears')
check(msUntilSoonChange(before, T(27, 8, 56)) === 4 * 60_000, 'and when it goes')
check(msUntilSoonChange(onShift, T(27, 12)) === (5 * 60 + 25) * 60_000, 'and when the clock-out heads-up appears')
check(msUntilSoonChange({ ...onShift, clockedOut: true }, T(27, 18)) === null, 'nothing more once clocked out')

// --- Wording.
const inMsg = soonMessage('clock_in_soon', '09:00:00', 'Ikeja Shop')
check(inMsg.title === 'Time to clock in'
  && inMsg.body === 'Your shift at Ikeja Shop starts at 09:00. Clock in with a selfie when you arrive.'
  && inMsg.url === '/field', 'the clock-in push names the store and the time and opens the app', inMsg)
const inNoStore = soonMessage('clock_in_soon', null, null)
check(inNoStore.body === 'Your shift starts at 08:00. Clock in with a selfie when you arrive.',
  'with no store it leaves the store out', inNoStore)
const outMsg = soonMessage('clock_out_soon', '17:30')
check(outMsg.body === 'Your shift ends at 17:30. Get ready to clock out with a selfie.' && outMsg.url === '/field',
  'the clock-out heads-up says when the shift ends', outMsg)
const words = [inMsg, inNoStore, outMsg].map((m) => `${m.title} ${m.body}`).join(' ').toLowerCase()
check(!/location|track|monitor|alert|supervisor|gps|late/.test(words), 'the heads-ups say nothing about monitoring')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL SHIFT REMINDER CHECKS PASSED')
