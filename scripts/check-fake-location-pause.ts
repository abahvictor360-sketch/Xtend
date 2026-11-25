/**
 * Checks a fake location pauses the account (0108): the flag pauses it,
 * the app signs the person out and says to contact their supervisor or
 * admin (never why), the evidence stays, and only the office lifts it.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-fake-location-pause.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { PAUSED_MESSAGE } from '@/lib/auth'

let failed = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`)
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const m = read('supabase/migrations/0108_pause_on_fake_location.sql')
check(/after insert on public\.integrity_flags/.test(m) && /new\.kind <> 'mock_location_confirmed'/.test(m) && /role in \('merchandiser', 'marketer'\)/.test(m),
  'a fake-GPS flag pauses a merchandiser or marketer at once')
check(/update public\.tracking_tokens set revoked_at = now\(\)/.test(m), 'their phone tracker is stopped')
check(/p\.is_active and p\.paused_at is null/.test(m), 'a paused account reads and writes nothing')
check(/if old\.paused_at is not null then/.test(m) && /can_unlock_sign_in\(p_user\)/.test(m) && /'user\.unpause'/.test(m),
  'staff cannot lift it; an admin or their supervisor can, and it is audited')

const auth = read('src/lib/auth.ts')
check(/if \(session\.profile\.paused_at\) redirect\('\/api\/auth\/paused'\)/.test(auth) && /if \(session\.profile\.paused_at\) throw new ApiError\(PAUSED_MESSAGE, 403, 'paused'\)/.test(auth),
  'every page signs them out and every request is refused')
check(PAUSED_MESSAGE === 'Your account is paused. Contact your supervisor or admin.' && !/fake|gps|location|monitor/i.test(PAUSED_MESSAGE),
  'they are told to contact their supervisor or admin, not why')
check(/signOut\(\)/.test(read('src/app/api/auth/paused/route.ts')) && /reason=paused/.test(read('src/app/api/auth/paused/route.ts'))
      && /paused: 'Your account is paused\. Contact your supervisor or admin\.'/.test(read('src/app/login/page.tsx')),
  'signed out, and the login page says it')
check(/paused: true, message: PAUSED_MESSAGE \}, \{ status: 201 \}/.test(read('src/app/api/attendance/route.ts'))
      && /window\.location\.href = '\/api\/auth\/paused'/.test(read('src/components/field/clock-panel.tsx')),
  'the clock-in that showed it is kept as evidence, then the phone signs them out')
const staff = read('src/components/admin/staff-manager.tsx')
check(staff.includes('Paused: fake GPS app') && staff.includes('void unpause(person)') && staff.includes('window.confirm('),
  'Staff shows the pause and an Unpause button, asked first')
check(/input\.unpause/.test(read('src/app/api/admin/users/[id]/route.ts')) && /rpc\('unpause_staff'/.test(read('src/app/api/admin/users/[id]/route.ts')),
  'Unpause goes through the database rule')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL FAKE LOCATION PAUSE CHECKS PASSED')
