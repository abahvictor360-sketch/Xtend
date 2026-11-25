/**
 * Checks that working hours belong to the person, not the store (0100):
 * the time rules (lib/fields.ts), the Staff forms and routes, Home and
 * Account showing the person's own hours, the store form without times,
 * and Ask Xtend setting people's hours. The database rules are tested in
 * supabase/tests/rules.sql.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-staff-hours.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { clockTime, hoursProblem } from '@/lib/fields'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

check(clockTime.safeParse('09:00').success && clockTime.safeParse('23:59').success, 'HH:MM times are taken')
check(!clockTime.safeParse('9:00').success && !clockTime.safeParse('24:00').success && !clockTime.safeParse('09:60').success, 'wrong times are refused')
check(hoursProblem(undefined, undefined) === null && hoursProblem('09:00', '17:00') === null, 'both or neither')
check(hoursProblem('09:00', undefined) !== null, 'one alone is refused')
check(hoursProblem('17:00', '09:00') !== null && hoursProblem('09:00', '09:00') !== null, 'the day must end after it starts')
// 0105: the clock-out window.
check(hoursProblem('08:30', '18:30', '18:00') === null && hoursProblem('08:30', '18:30', '18:30') === null && hoursProblem('08:30', '18:30', null) === null,
  'a window after the start and no later than the end is fine (or none)')
check(hoursProblem('08:30', '18:30', '19:00') !== null && hoursProblem('08:30', '18:30', '08:00') !== null, 'a window outside the day is refused')
check(hoursProblem(undefined, undefined, '18:00') !== null && hoursProblem(undefined, undefined, null) === null, 'a window comes with the hours')
check(/clock_out_from: optionalClockTime/.test(read('src/app/api/admin/users/route.ts')) && /'clock_out_from',/.test(read('src/app/api/admin/users/[id]/route.ts')),
  'creating and editing a person take the window')
check(/Can clock out from \(optional\)/.test(read('src/components/admin/staff-manager.tsx')) && /windowProblem/.test(read('src/components/admin/staff-manager.tsx')),
  'the staff form has the window and checks it')
check(/You can clock out from \$\{leaveFrom\}/.test(read('src/app/field/account/page.tsx')), 'staff see when they can clock out from')
const m105 = read('supabase/migrations/0105_clock_out_window.sql')
check(/new\.clock_out_from := old\.clock_out_from/.test(m105) && /they may clock out from/.test(m105) && /if minutes > 0 then/.test(m105),
  'staff cannot change it, and early is measured from it with no extra grace')

const mig = read('supabase/migrations/0100_shift_times_per_person.sql')
check(/add column shift_start time not null default time '08:00'/.test(mig) && /set shift_start = o\.shift_start, shift_end = o\.shift_end/.test(mig),
  'the person gets their home store’s times once, then their own')
check(/new\.shift_start   := old\.shift_start;/.test(mig), 'staff cannot change their own hours')
check(/'shift', \(/.test(mig) && /p\.shift_start,\n    p\.shift_end,/.test(mig), 'Home and attendance read the person’s hours')
check(read('scripts/test-sql.sh').includes('0100_shift_times_per_person.sql'), 'the migration is in the database tests')

const staffForm = read('src/components/admin/staff-manager.tsx')
check(/Clock in by/.test(staffForm) && /Day ends at/.test(staffForm) && /shift_start: draft\.shift_start/.test(staffForm), 'Staff sets hours when adding someone')
check(/changes\.shift_start = details\.shift_start/.test(staffForm) && /changes\.shift_end = details\.shift_end/.test(staffForm), 'and when editing (both together)')
check(/hoursProblem/.test(read('src/app/api/admin/users/route.ts')) && /hoursProblem/.test(read('src/app/api/admin/users/[id]/route.ts')), 'the server checks them')
check(/PGRST204/.test(read('src/app/api/admin/users/route.ts')), 'adding staff still works before 0100 is run')

const outletForm = read('src/components/admin/outlet-manager.tsx')
check(!/draft\.shift_start|Clock-in time/.test(outletForm) && /belong to each person/.test(outletForm), 'stores have no times any more')
check(!/shiftStart/.test(read('src/components/admin/store-importer.tsx')), 'nor the bulk store import')

const home = read('src/components/field/field-home.tsx')
check(/day\.shift\?\.start \?\? day\.outlet\?\.shift_start/.test(home), 'Home uses the person’s hours (the store’s before 0100)')
check(/Your hours/.test(read('src/app/field/account/page.tsx')), 'Account shows their hours')

check(/name: 'propose_hours'/.test(read('src/lib/assistant.ts')) && !/propose_outlet_hours/.test(read('src/lib/assistant.ts')), 'Ask Xtend sets people’s hours, not a store’s')
check(/case 'staff_hours'/.test(read('src/app/api/admin/ask/act/route.ts')), 'and carries them out through the Staff route (audited)')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL STAFF HOURS CHECKS PASSED')
