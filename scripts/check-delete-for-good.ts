/**
 * Checks deleting a store or a person for good (0098): the plain words for
 * what goes with them (src/lib/delete-for-good.ts), the typed-name
 * confirmation, and that Outlets and Staff offer it when a plain delete is
 * refused for history. The database rules are tested in rules.sql.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-delete-for-good.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { describeRecords, nameMatches } from '@/lib/delete-for-good'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const lines = describeRecords({ attendance: 12, location_pings: 340, reports: 1, tracking_tokens: 4, store_visits: 0 })
check(JSON.stringify(lines) === JSON.stringify(['340 movement points', '12 clock-ins and clock-outs', '1 report']),
  'records read in plain words, most first, one in the singular, housekeeping and zeros left out', lines)
check(JSON.stringify(describeRecords({ count_requests: 2, count_request_targets: 3 })) === JSON.stringify(['5 count requests']),
  'tables that read the same are added together')
check(describeRecords({ some_new_table: 2 })[0] === '2 some new table', 'a table without words still reads')
check(describeRecords(null).length === 0, 'nothing to list')
check(nameMatches(' Test Store ', 'Test Store') && !nameMatches('test store', 'Test Store') && !nameMatches('', ''),
  'the name must be typed as shown (spaces at the ends do not matter)')

const mig = read('supabase/migrations/0098_delete_for_good.sql')
check(/is_admin\(\)/.test(mig) && /your own account/.test(mig) && /last admin/.test(mig), 'admins only, never yourself or the last admin')
check(/Type the name exactly as shown/.test(mig), 'the database checks the typed name too')
check(/conrelid <> 'public\.audit_log'::regclass/.test(mig), 'the audit log is never deleted from')
check(/insert into public\.system_reset_files/.test(mig), 'their photos are queued for removal')
check(/delete_for_good/.test(read('scripts/test-sql.sh').replace(/0098_delete_for_good/, 'delete_for_good')), 'the migration is in the database tests')

const route = read('src/app/api/admin/delete-for-good/route.ts')
check(/requireApiSession\(\['admin'\]\)/.test(route) && /requireRecentAuth\(session\)/.test(route), 'admins only, with the password again')
check(/removeQueuedFiles/.test(route) && /auth\.admin\.deleteUser/.test(route), 'files and the sign-in are removed by the server')

const dialog = read('src/components/admin/delete-for-good.tsx')
check(/Are you sure you want to delete/.test(dialog) && /Yes, delete for good/.test(dialog) && /Deactivate instead/.test(dialog),
  'the dialog asks, lists what goes, and offers to deactivate instead')
check(/disabled=\{busy \|\| lines === null \|\| !nameMatches\(typed, name\)\}/.test(dialog), 'it cannot be pressed until the name is typed')

for (const [file, label] of [
  ['src/components/admin/outlet-manager.tsx', 'Outlets'],
  ['src/components/admin/staff-manager.tsx', 'Staff'],
] as const) {
  const src = read(file)
  check(/data\.history/.test(src) && /<DeleteForGoodDialog/.test(src), `${label} offers delete for good when a plain delete is refused`)
}
check(/history: true/.test(read('src/app/api/admin/outlets/[id]/route.ts')) && /history: true/.test(read('src/app/api/admin/users/[id]/route.ts')),
  'the plain deletes say when it is history that holds them back')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL DELETE FOR GOOD CHECKS PASSED')
