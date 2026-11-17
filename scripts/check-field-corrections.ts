/**
 * Checks for the office fixing someone's day (0090): every action has a
 * label and a message, and the message carries the office's reason.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-field-corrections.ts
 */
import assert from 'node:assert/strict'
import { CORRECTION_ACTIONS, CORRECTION_LABELS, correctionNotice, planCorrection, redoBanner, type CorrectionDay } from '../src/lib/field-corrections'
import { actionSchema } from '../src/lib/assistant-action-types'
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

// --- Ask Xtend's card (planCorrection) --------------------------------------
const ID = '11111111-1111-4111-8111-111111111111'
const MALL = '44444444-4444-4444-8444-444444444444'
const SHOP = '55555555-5555-4555-8555-555555555555'
const V1 = '66666666-6666-4666-8666-666666666666'
const V2 = '77777777-7777-4777-8777-777777777777'
const fresh: CorrectionDay = {
  name: 'Ada Obi', role: 'marketer', active: true, homeStoreId: MALL,
  stores: [{ id: MALL, name: 'Ikeja City Mall' }, { id: SHOP, name: 'Justrite Bariga' }],
  clockedIn: false, clockedOut: false, visits: [],
}
const plan = (day: CorrectionDay, action: (typeof CORRECTION_ACTIONS)[number], extra: Partial<{ storeId: string | null; time: string | null; reason: string }> = {}) =>
  planCorrection(ID, day, { action, storeId: null, time: null, reason: 'Phone would not open', ...extra }, '2026-11-17', '10:30')
const refuses = (fn: () => unknown, like: RegExp) => {
  try {
    fn()
    return false
  } catch (e) {
    return like.test((e as Error).message)
  }
}
const inAt = plan(fresh, 'office_clock_in', { time: '08:05' })
check(inAt.payload.outlet_id === MALL && inAt.payload.at === '2026-11-17T08:05:00+01:00', 'Ask Xtend: a clock-in goes to their usual store, at the time given (Lagos)')
check(actionSchema.safeParse({ kind: 'field_correction', payload: inAt.payload }).success, 'Ask Xtend: what the card sends is what Apply accepts')
check(plan(fresh, 'office_clock_in', { storeId: SHOP }).payload.outlet_id === SHOP && plan(fresh, 'office_clock_in').payload.at === null, 'Ask Xtend: another of their stores, and no time means now')
check(refuses(() => plan(fresh, 'office_clock_in', { storeId: V1 }), /not one of Ada's stores/), 'Ask Xtend: not a store of theirs is refused')
check(refuses(() => plan(fresh, 'office_clock_in', { time: '11:00' }), /later than now/), 'Ask Xtend: a time later than now is refused')
check(refuses(() => plan(fresh, 'office_clock_in', { reason: ' ' }), /Say why/), 'Ask Xtend: a reason is always needed')
check(refuses(() => plan(fresh, 'office_clock_out'), /not clocked in/), 'Ask Xtend: no clock-out before a clock-in')
check(refuses(() => plan(fresh, 'redo_clock_in'), /nothing to redo/), 'Ask Xtend: nothing to redo before a clock-in')
check(refuses(() => plan({ ...fresh, homeStoreId: null }, 'office_clock_in'), /Say which store/), 'Ask Xtend: with no usual store, it asks which')
check(refuses(() => plan({ ...fresh, active: false }, 'office_clock_in'), /active merchandiser or marketer/), 'Ask Xtend: never for a deactivated account')
check(refuses(() => plan({ ...fresh, role: 'supervisor' }, 'office_clock_in'), /active merchandiser or marketer/), 'Ask Xtend: only field staff')
const inDay = { ...fresh, clockedIn: true }
check(plan(inDay, 'office_clock_in').warning !== null && plan(fresh, 'office_clock_in').warning === null, 'Ask Xtend: clocking in again warns that it replaces the clock-in')
check(plan(inDay, 'redo_clock_in').payload.outlet_id === null && plan(inDay, 'redo_clock_in').payload.action === 'redo_clock_in', 'Ask Xtend: asking to clock in again')
check(refuses(() => plan({ ...inDay, clockedOut: true }, 'redo_clock_in'), /already clocked out/), 'Ask Xtend: no clock-in redo after a clock-out (as the database)')
check(refuses(() => plan({ ...inDay, role: 'merchandiser' }, 'office_check_in'), /for marketers/), 'Ask Xtend: store check-ins are for marketers')
check(plan(inDay, 'office_check_in', { storeId: SHOP }).title === 'Check Ada Obi in at Justrite Bariga', 'Ask Xtend: checking a marketer in at a store')
const visiting = { ...inDay, visits: [{ id: V1, storeId: MALL, name: 'Ikeja City Mall', status: 'closed' }, { id: V2, storeId: SHOP, name: 'Justrite Bariga', status: 'open' }] }
check(refuses(() => plan(visiting, 'office_check_in'), /still checked in at Justrite Bariga/), 'Ask Xtend: no second check-in while one is open')
check(plan(visiting, 'office_check_out').title === 'Check Ada Obi out of Justrite Bariga', 'Ask Xtend: checking out of the open visit')
check(refuses(() => plan(visiting, 'redo_check_in'), /Say which store visit/), 'Ask Xtend: two visits and no store: it asks which')
check(plan(visiting, 'redo_check_in', { storeId: MALL }).payload.visit_id === V1, 'Ask Xtend: the visit at the named store')
check(plan(visiting, 'redo_check_out').payload.visit_id === V1, 'Ask Xtend: only a closed visit can be checked out again')

console.log(`\nALL ${passed} FIELD CORRECTION CHECKS PASSED`)
