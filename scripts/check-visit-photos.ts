/**
 * Store check-ins and check-outs for the office, with both photos
 * (migration 0091): the app takes a selfie at check-out as at check-in,
 * the server keeps it, and Attendance, a person's day and Store visits
 * show where and when each check-in and check-out happened.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-visit-photos.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toDayVisit } from '@/components/admin/visit-photo-list'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

// The office's view of a visit row.
const row = {
  id: 'v1', status: 'closed', arrived_at: '2026-11-17T09:00:00Z', departed_at: '2026-11-17T10:00:00Z', minutes: 60,
  arrived_status: 'on_site', departed_status: 'off_site', arrived_distance_m: 12, departed_distance_m: 400,
  arrived_label: 'Shoprite Surulere', departed_label: 'Bode Thomas St', store_label: 'Shoprite Surulere', outlet_name: 'Shoprite',
  selfie_path: 'u/in.jpg', thumb_path: 'u/in_thumb.jpg', departed_selfie_path: 'u/out.jpg', departed_thumb_path: 'u/out_thumb.jpg',
}
const d = toDayVisit(row)
check(d.in_photo === 'u/in_thumb.jpg' && d.out_photo === 'u/out_thumb.jpg', 'the thumbnails are shown when there are some', d)
check(toDayVisit({ ...row, thumb_path: null, departed_thumb_path: null }).out_photo === 'u/out.jpg', 'else the full photo')
check(toDayVisit({ ...row, departed_selfie_path: null, departed_thumb_path: null }).out_photo === null,
  'a visit closed without a photo (older app, or the office) has none')
check(toDayVisit({ ...row, store_label: null }).store === 'Shoprite' && toDayVisit({ ...row, store_label: null, outlet_name: null }).store === 'A place',
  'the store name falls back to the outlet, then "A place"')

// The app: location, then the camera, then the photo with the check-out.
const app = read('src/components/field/store-visits.tsx')
check(/const beginCheckOut = useCallback[\s\S]*?await requireFix\(\)[\s\S]*?setLeaving\(\{ fix, place \}\)/.test(app),
  'checking out reads the location first, then opens the camera')
check(/<CameraCapture\s+open=\{leaving !== null\}[\s\S]*?onCapture=\{\(photo\) => void checkOut\(photo\)\}/.test(app),
  'the check-out camera sends its photo to the check-out')
check(/const checkOut = useCallback\(async \(photo: Blob\)[\s\S]*?uploadVisitSelfie\(photo, setBusy\)[\s\S]*?selfie_path,\s*thumb_path,/.test(app),
  'the check-out uploads, checks and sends the selfie, as the check-in does')
check(/STALE_FIX_MS[\s\S]*?const checkOut/.test(app) && /const checkOut = useCallback[\s\S]*?Date\.now\(\) - Date\.parse\(fix\.captured_at\) > STALE_FIX_MS/.test(app),
  'a location gone stale while the camera was open is read again')

// The server.
const route = read('src/app/api/visits/[id]/end/route.ts')
check(/isOwnStoragePath\(path, session\.userId\)/.test(route) && /p_selfie_path: parsed\.data\.selfie_path \?\? null/.test(route),
  'the check-out route takes only photos from the person’s own folder')
check(/if \(error && checkoutWithoutPhoto\(error\)\)/.test(route) && /PGRST202/.test(route),
  'before migration 0091 the check-out still goes through, without the photo')
const sql = read('supabase/migrations/0091_visit_checkout_photo.sql')
check(/check-out photo is not yours/.test(sql) && /departed_selfie_path = p_selfie_path/.test(sql),
  'the database checks the folder too, and keeps the photo')
check(/union\s+select unnest\(array_remove\(array\[v\.departed_selfie_path, v\.departed_thumb_path\], null\)\)/.test(sql),
  'check-out photos are deleted after 14 days with the others')

// The office.
const page = read('src/app/admin/attendance/page.tsx')
const table = read('src/components/admin/attendance-table.tsx')
check(/fetchVisits\(supabase, \{ from: filter\.from, to: filter\.to, user_id: filter\.user_id/.test(page)
    && /visits=\{visitsByDay\}/.test(page), 'Attendance loads the store visits of the days it lists')
check(/\.\.\.\(visits\[row\.key\] \?\? \[\]\)\.flatMap\(\(v\) => \[v\.in_photo, v\.out_photo\]\)/.test(table)
    && /<VisitPhotoList visits=\{visits\}/.test(table) && /store\{visits === 1 \? '' : 's'\} visited/.test(table),
  'an Attendance row says how many stores, and opens to every check-in and check-out with both photos')
const day = read('src/app/admin/attendance/day/page.tsx')
check(/from\('store_visit_detail'\)/.test(day) && /<VisitPhotoList visits=\{visitList\}/.test(day),
  'a person’s day lists the check-ins and check-outs with both photos')
const views = read('src/components/admin/visit-views.tsx')
check(/leftSelfie/.test(views) && /departed_selfie_path \?\? null/.test(read('src/app/admin/visits/page.tsx')),
  'Store visits shows the check-out photo beside the check-in one')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL VISIT PHOTO CHECKS PASSED')
