/**
 * Checks allocating staff from a store on Outlets: the "Allocate staff"
 * button under each store, the search of marketers and merchandisers, and
 * that it changes only that store for that person, through set_store_staff
 * (0097), with the whole-list function as a stand-in before 0097 is run.
 * The database rules themselves are tested in supabase/tests/rules.sql.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-store-staff.ts
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

const mig = read('supabase/migrations/0097_allocate_from_store.sql')
check(/function public\.set_store_staff\(p_outlet uuid, p_user uuid, p_on boolean\)/.test(mig), 'set_store_staff(outlet, person, on) exists')
check(/can_allocate_outlets\(p_user\)/.test(mig), 'it uses the same permission as Store allocation')
check(/insert into public\.audit_log/.test(mig) && /staff\.allocate_store/.test(mig), 'every change is audited')
check(/delete from public\.staff_outlets where user_id = p_user and outlet_id = p_outlet/.test(mig), 'removing touches only that store')
check(read('scripts/test-sql.sh').includes('0097_allocate_from_store.sql'), 'the migration is in the database tests')
check(/from a store: a person is added there and keeps their other stores/.test(read('supabase/tests/rules.sql')), 'rules.sql tests it')

const route = read('src/app/api/admin/outlets/[id]/staff/route.ts')
check(/requireApiSession\(\['admin', 'supervisor'\]\)/.test(route), 'admins and supervisors may allocate (the database narrows supervisors to their team)')
check(/rpc\('set_store_staff'/.test(route) && /PGRST202/.test(route) && /rpc\('set_staff_outlets'/.test(route), 'the route uses 0097, or the whole-list function before it is run')

const panel = read('src/components/admin/store-staff.tsx')
check(/Search marketers or merchandisers/.test(panel), 'the panel searches marketers and merchandisers')
check(/'Merchandisers'/.test(panel) && /'Marketers'/.test(panel), 'with Merchandisers and Marketers buttons')
check(/Home store/.test(panel) && /Remove/.test(panel) && /Allocate/.test(panel), 'it shows the home store, and allocates and removes')
check(/p\.is_active && !homeHere\(p\) && !allocatedHere\(p\)/.test(panel), 'only active people not already there are offered')

const manager = read('src/components/admin/outlet-manager.tsx')
check(/Allocate staff/.test(manager) && /<StoreStaff /.test(manager), 'each store has an Allocate staff button')
const page = read('src/app/admin/outlets/page.tsx')
check(/from\('staff_allocation'\)/.test(page) && /canAllocate/.test(page), 'the Outlets page passes who can be allocated (through RLS)')
check(/Allocate staff/.test(read('src/app/admin/guide/page.tsx')) && /Allocate staff/.test(read('src/app/admin/supervisor-guide/page.tsx')),
  'the admin and supervisor guides explain it')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL STORE STAFF CHECKS PASSED')
