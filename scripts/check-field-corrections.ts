/**
 * Checks for the office fixing someone's day (0090): every action has a
 * label and a message, and the message carries the office's reason.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-field-corrections.ts
 */
import assert from 'node:assert/strict'
import {
  parseCorrectionCommand, CORRECTION_ACTIONS, CORRECTION_LABELS, correctionNotice, planCorrection, redoBanner, type CorrectionDay } from '../src/lib/field-corrections'
import { actionSchema } from '../src/lib/assistant-action-types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

// The latest list of actions the database allows (0093 added reset_clock_out).
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0093_reset_clock_out.sql'), 'utf8')
const dbActions = (sql.match(/field_corrections_action_check check \(action in \(([\s\S]*?)\)\)/)?.[1] ?? '')
  .match(/'([a-z_]+)'/g)
  ?.map((s) => s.replace(/'/g, ''))
check(
  JSON.stringify([...(dbActions ?? [])].sort()) === JSON.stringify([...CORRECTION_ACTIONS].sort()),
  'the app and the database know the same nine actions',
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

// Undoing a clock-out made by mistake (0093).
check(refuses(() => plan(inDay, 'reset_clock_out'), /nothing to undo/), 'Ask Xtend: nothing to undo before a clock-out')
const undo = plan({ ...inDay, clockedOut: true }, 'reset_clock_out', { reason: 'Clocked out by mistake' })
check(undo.title === "Undo Ada Obi's clock-out (back on shift)" && undo.payload.outlet_id === null && undo.payload.at === null,
  'Ask Xtend: undoing a clock-out needs no store or time')
check(actionSchema.safeParse({ kind: 'field_correction', payload: undo.payload }).success, 'Ask Xtend: Apply accepts the undo')
const back = correctionNotice('reset_clock_out', { by: 'Sola', store: null, time: '', reason: 'Clocked out by mistake.' })
check(back.title === 'You are back on shift' && /clock out again/i.test(back.body), 'the person is told they are back on shift and to clock out again later')
check(!/locat|track|follow/i.test(back.body), 'the person is not told how they are monitored')
const route = readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'admin', 'field-corrections', 'route.ts'), 'utf8')
check(/action === 'reset_clock_out'[\s\S]{0,200}office_reset_clock_out/.test(route), 'the route undoes it through office_reset_clock_out')
const panel = readFileSync(join(__dirname, '..', 'src', 'components', 'admin', 'day-corrections.tsx'), 'utf8')
check(/action: 'reset_clock_out', label: 'Undo the clock-out \(back on shift\)', off: !clockedOut \?/.test(panel), 'Fix today\'s record offers Undo the clock-out once they have clocked out')
check(plan(visiting, 'redo_check_out').payload.visit_id === V1, 'Ask Xtend: only a closed visit can be checked out again')


// Typed commands in Fix today's record.
const STORES = [{ id: MALL, name: 'Shoprite Ikeja City Mall' }, { id: SHOP, name: 'Spar Lekki' }]
const read = (c: string) => parseCorrectionCommand(c, STORES)
const c1 = read('Clock Ada in at 8:05 because her phone would not open')
check(c1.action === 'office_clock_in' && c1.time === '08:05' && c1.reason === 'Her phone would not open', 'command: clock in at a time, with the reason after "because"')
const c2 = read('clock her out at 5pm, phone died')
check(c2.action === 'office_clock_out' && c2.time === '17:00' && c2.reason === 'Phone died', 'command: clock out at 5pm, reason after a comma')
check(read('undo the clock-out, she tapped it by mistake').action === 'reset_clock_out', 'command: undo the clock-out')
check(read('She clocked out by mistake, put her back on shift').action === 'reset_clock_out', 'command: clocked out by mistake puts them back on shift')
check(read('ask him to clock in again with a clear selfie').action === 'redo_clock_in', 'command: ask them to clock in again')
check(read('ask her to clock out again').action === 'redo_clock_out', 'command: ask them to clock out again')
const c3 = read('check her in at Spar Lekki - GPS would not lock')
check(c3.action === 'office_check_in' && c3.storeId === SHOP && c3.reason === 'GPS would not lock', 'command: check in at a named store')
check(read('check him out of shoprite, he left').action === 'office_check_out' && read('check him out of shoprite, he left').storeId === MALL, 'command: one word of the store name is enough')
check(read('ask her to check out again at Ikeja').action === 'redo_check_out', 'command: ask them to check out again')
check(read('clocked out in the morning').action === 'office_clock_out', 'command: "out in" is a clock-out, not both')
check(read('clock in at 8').time === '08:00' && read('clock in at 3').time === '15:00', 'command: 1 to 6 without am/pm is the afternoon')
check(refuses(() => read('clock in and clock out'), /One thing at a time/), 'command: one thing at a time')
check(refuses(() => read('hello'), /Say clock in/), 'command: says what it understands')
check(refuses(() => read('undo the clock-in'), /Only a clock-out can be undone/), 'command: only a clock-out can be undone')
check(refuses(() => read('clock in at 25:00'), /does not look right/), 'command: an impossible time is refused')
const panelNow = readFileSync(join(__dirname, '..', 'src', 'components', 'admin', 'day-corrections.tsx'), 'utf8')
check(/parseCorrectionCommand\([\s\S]{0,200}planCorrection\(/.test(panelNow) && /Do it/.test(panelNow), 'Fix today\'s record reads the command, shows what it will do, and does it on Do it')
check(['Clock-in', 'Clock-out', 'Store check-in', 'Store check-out'].every((g) => panelNow.includes(`title: '${g}'`)), 'the options come in four groups')

// --- Where the office records them (0112) ---------------------------------
const where = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0112_office_entry_location.sql'), 'utf8')
check(/p_lat double precision default null/.test(where) && /function public\.office_where/.test(where),
  'office entries take an optional spot; none means the store\'s pin (0112)')
check(/'location_from', w\.source/.test(where), 'each office entry says whether it was the store or a picked spot')
check(/office_store_id/.test(where) && /when \(public\.office_entry_on\(\)\)/.test(where),
  'an office clock-in at a picked spot is measured against the store the office chose')
const whereRoute = readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'admin', 'field-corrections', 'route.ts'), 'utf8')
check(/input\.lat != null && input\.lng != null/.test(whereRoute), 'the route sends a spot only when one was picked')
const wherePanel = readFileSync(join(__dirname, '..', 'src', 'components', 'admin', 'day-corrections.tsx'), 'utf8')
check(/Where is \{first\}\?/.test(wherePanel) && /Where their phone was/.test(wherePanel) && /Pick on the map/.test(wherePanel),
  'the panel asks where they are: the store, their phone, or the map')

console.log(`\nALL ${passed} FIELD CORRECTION CHECKS PASSED`)
