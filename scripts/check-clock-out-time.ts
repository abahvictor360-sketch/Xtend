/**
 * Checks for "no clocking out before it is time" (0109): from when the app
 * lets someone clock out, what they are told, and that the app and the
 * database agree on the rule.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-clock-out-time.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLOCK_OUT_GRACE_MINUTES,
  clockOutOpensAt,
  lagosClock,
  tooEarlyFromServer,
  tooEarlyToClockOut,
  tooEarlyWords,
} from '../src/lib/clock-out-time'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

check(clockOutOpensAt('18:30:00', '18:00:00') === '18:00', 'their "can clock out from" time comes first')
check(clockOutOpensAt('18:00:00', null) === '17:45', 'with none set, 15 minutes before the end of their day')
check(clockOutOpensAt('18:00', '') === '17:45', 'an empty window counts as none')
check(clockOutOpensAt(null, null) === null, 'unknown hours: nothing is held back')
check(clockOutOpensAt('00:10', null) === '00:00', 'never before midnight')

const day = '2026-11-25'
check(tooEarlyToClockOut('18:00', day, Date.parse('2026-11-25T17:59:00+01:00')), 'a minute before: too early')
check(!tooEarlyToClockOut('18:00', day, Date.parse('2026-11-25T18:00:00+01:00')), 'from the time itself: allowed')
check(!tooEarlyToClockOut('18:00', day, Date.parse('2026-11-26T08:00:00+01:00')), 'a day that has passed is never too early')
check(!tooEarlyToClockOut(null, day, Date.parse('2026-11-25T09:00:00+01:00')), 'no time known: allowed')
check(lagosClock(Date.parse('2026-11-25T16:59:00Z')) === '17:59', 'the clock is Lagos time')

const merch = tooEarlyWords('18:00', false, null)
check(merch.startsWith('It is not time to clock out yet. You can clock out from 18:00.'), 'says from when')
check(!/check in/i.test(merch), 'a merchandiser is not sent to check in at stores')
check(/check in and check out at your stores/.test(tooEarlyWords('18:00', true, null)), 'a marketer is pointed to their store check-ins')
check(/checked in at Ikeja City Mall: check out of it/.test(tooEarlyWords('18:00', true, 'Ikeja City Mall')), 'a marketer in a store is told to check out of it when they leave')

check(tooEarlyFromServer({ code: 'too_early', opens_at: '18:00' }) === '18:00', 'the server\'s refusal carries the time')
check(tooEarlyFromServer({ code: 'off_site' }) === null && tooEarlyFromServer(null) === null, 'other refusals are not read as too early')

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0109_no_early_clock_out.sql'), 'utf8')
check(sql.includes('It is not time to clock out yet. You can clock out from %.'), 'the database says the same first sentence')
check(/punctuality_grace_minutes/.test(sql) && CLOCK_OUT_GRACE_MINUTES === 15, 'the database and the app use the same 15 minutes')
check(/when \(not public\.office_entry_on\(\)\)/.test(sql), 'the office can still clock someone out (0090)')

const hold = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0111_clock_out_hold.sql'), 'utf8')
check(/hold_clock_out boolean not null default true/.test(hold), 'the clock-out hold is on for everyone unless the office turns it off (0111)')
check(/new\.hold_clock_out := old\.hold_clock_out/.test(hold), 'staff cannot turn off their own hold')
check(/may_correct_field\(p_user\)/.test(hold), 'only an admin, HR or their own supervisor can switch it')
check(/It is not time to clock out yet\. You can clock out from %\./.test(hold), 'with the hold on, the refusal is unchanged')
const page = readFileSync(join(__dirname, '..', 'src', 'app', 'field', 'page.tsx'), 'utf8')
check(/hold_clock_out !== false/.test(page), 'with the hold off, the app lets them clock out too')

console.log(`\nALL ${passed} CLOCK-OUT TIME CHECKS PASSED`)
