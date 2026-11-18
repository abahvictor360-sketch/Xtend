/**
 * The staff video guide (public/guide/xtend-staff-guide.mp4):
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-staff-video.ts
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STAFF_VIDEO } from '@/lib/staff-video'

let failed = 0
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}`)
  if (!ok) failed++
}
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const size = (p: string) => {
  try {
    return statSync(join(root, 'public', p)).size
  } catch {
    return 0
  }
}
check(size(STAFF_VIDEO.src) > 500_000 && size(STAFF_VIDEO.src) < 15_000_000, 'the video is there, and small enough for phone data (under 15 MB)')
check(size(STAFF_VIDEO.poster) > 0, 'the poster is there')
check(STAFF_VIDEO.chapters.length === 10, 'ten chapters')
check(
  STAFF_VIDEO.chapters.every((c, i) => c.at < STAFF_VIDEO.seconds && (i === 0 || c.at > STAFF_VIDEO.chapters[i - 1].at)),
  'chapters start in order, inside the video',
)

const scenes = read('src/components/video/staff-video-scenes.tsx')
const said = [...scenes.matchAll(/(?:title|sub): '([^']*)'|(?:title|sub): `([^`]*)`/g)].map((m) => m[1] ?? m[2]).join(' ')
check(!/\b(track|tracking|monitor|watch(ed|ing)? you|follow(ed|ing)? you|integrity|alert)\b/i.test(said),
  'the video says what to switch on, never how staff are monitored')
check(/Allow all the time/.test(scenes) && /Unrestricted/.test(scenes) && /Clock in with selfie/.test(scenes),
  'the video uses the app’s own words for location, battery and clocking in')
check(/process\.env\.NODE_ENV === 'production'\) notFound\(\)/.test(read('src/app/guide/video-scenes/page.tsx')),
  'the scene page is for development only')
check(/\?download=1/.test(read('src/components/staff-video.tsx')) && /xtend-staff-guide\.mp4'[\s\S]{0,120}attachment/.test(read('next.config.ts')),
  'Download the video saves it (an attachment, which the phone app can save too)')
check(/<StaffVideo \/>/.test(read('src/components/staff-guide.tsx')), 'the staff guide (on the site and in the app) opens with the video')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL STAFF VIDEO CHECKS PASSED')
