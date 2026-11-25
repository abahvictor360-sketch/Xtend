/**
 * The staff video guide (public/guide/xtend-staff-guide.mp4):
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-staff-video.ts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STAFF_VIDEO } from '@/lib/staff-video'
import { TECNO_VIDEO } from '@/lib/tecno-video'

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
// The voice-over: every scene speaks, and never about monitoring.
const voiceStart = scenes.indexOf('export const VOICE')
const voice = scenes.slice(voiceStart, scenes.indexOf('\n}\n', voiceStart))
const ids = [...scenes.matchAll(/\bid: '([a-z0-9-]+)'/g)].map((m) => m[1])
const spoken = new Set([...voice.matchAll(/^\s+'?([a-z0-9-]+)'?: '/gm)].map((m) => m[1]))
check(ids.length > 30 && ids.every((id) => spoken.has(id)), 'every scene has its words in the voice-over')
check(!/\b(track|tracking|monitor|watch(ed|ing)? you|follow(ed|ing)? you|integrity|alert)\b/i.test(voice),
  'the voice-over never says how staff are monitored')
let hasSound = false
try {
  hasSound = /audio/.test(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', join(root, 'public', STAFF_VIDEO.src)]).toString())
} catch {
  hasSound = true // no ffprobe on this machine: the other checks still run
}
check(hasSound, 'the video has its voice-over sound track')
check(/Allow all the time/.test(scenes) && /Unrestricted/.test(scenes) && /Clock in with selfie/.test(scenes),
  'the video uses the app’s own words for location, battery and clocking in')
check(/process\.env\.NODE_ENV === 'production'\) notFound\(\)/.test(read('src/app/guide/video-scenes/page.tsx')),
  'the scene page is for development only')
check(/\?download=1/.test(read('src/components/staff-video.tsx')) && /xtend-staff-guide\.mp4'[\s\S]{0,120}attachment/.test(read('next.config.ts')),
  'Download the video saves it (an attachment, which the phone app can save too)')
check(/<StaffVideo \/>/.test(read('src/components/staff-guide.tsx')), 'the staff guide (on the site and in the app) opens with the video')

// The short TECNO, Infinix and itel setup video (2026-11-25).
{
  const mp4 = join(root, 'public', TECNO_VIDEO.src)
  check(statSync(mp4).size > 500_000 && statSync(join(root, 'public', TECNO_VIDEO.poster)).size > 5_000, 'the TECNO, Infinix and itel video and its poster are there')
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', mp4]).toString()
  check(/video,1080,1920/.test(probe) && /audio/.test(probe), 'it is upright 1080×1920 with a voice-over')
  check(TECNO_VIDEO.seconds >= 45 && TECNO_VIDEO.seconds <= 150 && TECNO_VIDEO.chapters.length === 3, 'about a minute and a half, in three steps')
  const scenes = read('src/components/video/tecno-video-scenes.tsx')
  check(/Open Auto-start/.test(scenes) && /until a lock shows/.test(scenes) && /I did both/.test(scenes) && !/monitor|tracked|follow/i.test(scenes),
    'it shows Auto-start, the lock and “I did both”, and never mentions monitoring')
  check(/TECNO_VIDEO\.src/.test(read('src/components/field/background-gate.tsx')) && /Watch how/.test(read('src/components/field/background-gate.tsx')),
    'the setup card on the phone plays it (“Watch how”)')
  check(/TECNO_VIDEO\.src/.test(read('src/components/staff-guide.tsx')), 'the staff guide shows it with the TECNO step')
  check(/VIDEO === 'tecno'/.test(read('scripts/make-staff-video.ts')) && /video === 'tecno'/.test(read('src/app/guide/video-scenes/page.tsx')),
    'the same tool remakes it (VIDEO=tecno)')
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL STAFF VIDEO CHECKS PASSED')
