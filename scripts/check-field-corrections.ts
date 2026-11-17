/**
 * Checks for the office fixing someone's day (0090): every action has a
 * label and a message, and the message carries the office's reason.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-field-corrections.ts
 */
import assert from 'node:assert/strict'
import { CORRECTION_ACTIONS, CORRECTION_LABELS, correctionNotice, redoBanner } from '../src/lib/field-corrections'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0090_field_corrections.sql'), 'utf8')
const dbActions = (sql.match(/action\s+text not null check \(action in \(([\s\S]*?)\)\)/)?.[1] ?? '')
  .match(/'([a-z_]+)'/g)
  ?.map((s) => s.replace(/'/g, ''))
check(
  JSON.stringify([...(dbActions ?? [])].sort()) === JSON.stringify([...CORRECTION_ACTIONS].sort()),
  'the app and the database know the same eight actions',
)

for (const action of CORRECTION_ACTIONS) {
  const n = correctionNotice(action, { by: 'Sola Ade', store: 'Ikeja City Mall', time: '08:05', reason: 'Phone broke.' })
  check(Boolean(CORRECTION_LABELS[action]) && n.title.length > 0, `${action}: has a label and a title`)
  check(n.body.includes('Sola Ade') && n.body.includes('Phone broke.'), `${action}: says who did it and why`)
}
check(
  correctionNotice('office_clock_in', { by: 'Sola', store: 'Ikeja City Mall', time: '08:05', reason: 'x' }).body.includes(
    'at Ikeja City Mall at 08:05',
  ),
  'a clock-in made by the office says where and when',
)
check(correctionNotice('redo_clock_in', { by: 'Sola', store: null, time: '', reason: 'Use your selfie' }).title === 'Please clock in again',
  'asked to redo: the title says what to do')
check(redoBanner('redo_clock_in') !== null && redoBanner('redo_clock_out') !== null, 'Home shows a request to clock in or out again')
check(redoBanner('redo_check_in') === null && redoBanner('office_clock_in') === null,
  'store visits and office entries need nothing on Home (the visit itself changes)')
check(!/supervisor/i.test(redoBanner('redo_clock_in') ?? ''), 'Home says "the office", since admins and HR may ask too')

console.log(`\nALL ${passed} FIELD CORRECTION CHECKS PASSED`)
