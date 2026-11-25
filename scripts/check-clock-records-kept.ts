/**
 * Checks a clock-in can never exist without where it was taken and the
 * selfie, and that one saved with no signal is not lost or sent as the
 * wrong person (2026-11-25, 0107).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-clock-records-kept.ts
 */
import fs from 'node:fs'
import path from 'node:path'

let failed = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`)
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const init = read('supabase/migrations/0001_init.sql')
check(/lat\s+double precision not null,\s*\n\s*lng\s+double precision not null,\s*\n\s*accuracy_m\s+double precision not null/.test(init),
  'the database will not store a clock-in without its position and accuracy')
const photo = read('supabase/migrations/0023_photo_checks.sql')
check(/A clock-in needs a selfie taken in the app/.test(photo) && /photo_is_fresh\('selfies'/.test(photo) && /photo_already_used/.test(photo),
  'nor without a selfie taken in the app just now, checked, and not used before')
check(/for each row when \(not public\.office_entry_on\(\)\) execute function public\.selfie_check\(\)/.test(read('supabase/migrations/0090_field_corrections.sql')),
  'only an office entry (audited, by a supervisor or admin) has no selfie')

const db = read('src/lib/offline/db.ts')
check(/owner\?: string \| null/.test(db) && /const owner = await sessionOwner\(\)/.test(db), 'what a phone saves offline is stamped with who saved it')
const sync = read('src/lib/offline/sync.ts')
check(/filter\(\(r\) => !r\.owner \|\| r\.owner === me\)/.test(sync), 'it is only ever sent as that person, never as someone else on the same phone')
check(/function givesUp\(kind[^)]*\) \{\s*return kind !== 'clock' && kind !== 'ping'/.test(sync)
      && /givesUp\(record\.kind\) && record\.attempts >= MAX_ATTEMPTS/.test(sync),
  'a clock-in or position is never deleted for failed tries on a weak signal')
check(/noteClockFailed\(record, error\.message\)/.test(sync) && /noteClockFailed\(record, null\)/.test(sync),
  'a clock-in the server refuses, or that is over the 24 hours it allows, is never silent: the person is told')

const m = read('supabase/migrations/0107_offline_clock_day.sql')
check(/taken_day < new\.attendance_date/.test(m) && /trg_attendance_enforce_day/.test(m) && /new\.attendance_date <> public\.business_date\(\)/.test(m),
  'a clock-in sent after midnight keeps the day it was taken, and opens no store visit today (0107)')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL CLOCK RECORDS KEPT CHECKS PASSED')
