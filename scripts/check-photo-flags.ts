/**
 * A person's day for the office (Attendance → their name): every photo of
 * the day by location, and flagging one that is not right (migration 0092).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-photo-flags.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PHOTO_FLAG_LABEL, PHOTO_FLAG_REASONS, isPhotoFlagReason } from '@/lib/photo-flags'
import { FLAG_AREAS, FLAG_KINDS } from '@/lib/integrity'
import { flagHeadline } from '@/lib/flag-labels'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const sql = read('supabase/migrations/0092_photo_flags.sql')
const dbReasons = /array\[([^\]]+)\]/.exec(sql.slice(sql.indexOf('photo_flag_reasons()')))?.[1]
  .split(',').map((s) => s.trim().replace(/'/g, ''))
check(JSON.stringify(dbReasons) === JSON.stringify([...PHOTO_FLAG_REASONS]), 'the app and the database offer the same reasons', dbReasons)
check(PHOTO_FLAG_REASONS.every((r) => PHOTO_FLAG_LABEL[r]?.length > 3), 'every reason has words for the office')
check(isPhotoFlagReason('not_them') && !isPhotoFlagReason('because') && !isPhotoFlagReason(null), 'unknown reasons are refused')
check(FLAG_KINDS.photo_flagged?.label === 'Photo flagged by the office' && (FLAG_AREAS.photos as readonly string[]).includes('photo_flagged')
    && flagHeadline('photo_flagged') === 'photo flagged by the office',
  'Integrity knows the new kind, under Photos')
check(/PHOTO_KINDS = new Set\(\[[^\]]*'photo_flagged'/.test(read('src/components/admin/integrity-flags.tsx')),
  'Integrity can open the flagged photo')

const route = read('src/app/api/admin/photo-flags/route.ts')
check((route.match(/requireApiSession\(\['admin', 'supervisor'\]\)/g) ?? []).length === 2, 'only admins and supervisors may flag or unflag')
check(/audit\(supabase, 'photo\.flag'/.test(route) && /audit\(supabase, 'photo\.unflag'/.test(route), 'both are audited')

const page = read('src/app/admin/attendance/day/page.tsx')
check(/from\('attendance_detail'\)/.test(page) && /from\('store_visit_detail'\)/.test(page),
  'the day reads the clock events and store visits with their places and photos')
check(/path: c\.selfie_path/.test(page) && /path: v\.selfie_path/.test(page) && /path: v\.departed_selfie_path/.test(page),
  'the gallery has the clock-in/out, check-in and check-out photos')
check(/\.sort\(\(a, b\) => Date\.parse\(a\.at\) - Date\.parse\(b\.at\)\)/.test(page), 'in the order they were taken')
check(/signSelfies\(supabase, photos\.map\(\(p\) => p\.path\)\)/.test(page), 'photos are signed links, through the viewer’s own access')
check(/const canFlag = viewer === 'admin' \|\| \(viewer === 'supervisor' && person\.supervisor_id === session\.userId\)/.test(page),
  'the flag button shows for admins and the person’s own supervisor only (HR looks)')
check(/aria-label="The day before"/.test(page) && /next <= today/.test(page), 'previous and next day, never past today')

const gallery = read('src/components/admin/day-photo-gallery.tsx')
check(/fetch\('\/api\/admin\/photo-flags'/.test(gallery) && /Remove flag/.test(gallery) && /The person is not\s+told\./.test(gallery),
  'flag, change and remove from the photo, and the office is reminded staff are not told')
check(/disabled=\{busy \|\| \(reason === 'other' && !note\.trim\(\)\)\}/.test(gallery), '"Something else" needs a note')

const staffGuide = read('src/components/staff-guide.tsx')
check(!/flag(ged)? (this|a|your|the) photo|photo (was |is )?flagged/i.test(staffGuide),
  'the staff guide says nothing about photos being flagged')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL PHOTO FLAG CHECKS PASSED')
