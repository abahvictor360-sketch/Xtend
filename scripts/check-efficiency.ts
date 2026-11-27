/**
 * Efficiency (2026-11-27): no repeated work, caching where it is safe,
 * nothing woken or downloaded for nothing.
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-efficiency.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { haversineMetres } from '@/lib/distance'
import { metresBetween as movementMetres } from '@/lib/movement'
import { metresBetween as placeMetres } from '@/lib/place-resolve'
import { onScreen, whenVisible } from '@/lib/visible'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok  : ${label}`)
  else {
    failed++
    console.log(`FAIL: ${label}`, got ?? '')
  }
}
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

// One distance formula.
const copies = files('src').filter((p) => /Math\.asin\(Math\.sqrt/.test(read(p)))
check(copies.length === 1 && copies[0] === 'src/lib/distance.ts', 'the distance formula exists once (src/lib/distance.ts)', copies)
const d = haversineMetres(6.6, 3.35, 6.61, 3.35)
check(Math.abs(d - 1112) < 2 && movementMetres === haversineMetres && placeMetres === haversineMetres, 'every caller uses the same one, and it measures right', d)

// Read once per request.
for (const p of ['src/app/field/layout.tsx', 'src/app/field/page.tsx', 'src/app/field/account/page.tsx', 'src/app/field/count/page.tsx']) {
  check(!/rpc\('my_outlets'\)/.test(read(p)) && /myOutlets\(supabase\)/.test(read(p)), `${p}: the person's stores come from the per-request cache`)
}
check(/export const myOutlets = cache\(/.test(read('src/lib/my-outlets.ts')) && /xmSettingsOnce\(db\)/.test(read('src/lib/metrics/features-server.ts')),
  'stores and X Metrics switches are read once per request (React cache, never stale across requests)')

// No sign-in round trip without a sign-in cookie.
const mw = read('src/middleware.ts')
check(/hasSignInCookie\(request\) \? \(await supabase\.auth\.getUser\(\)\)\.data\.user : null/.test(mw) && /c\.name\.startsWith\('sb-'\) && c\.name\.includes\('-auth-token'\)/.test(mw),
  'the middleware asks Supabase who it is only when there is a sign-in cookie')

// Timers sleep while the app is in the background.
check(onScreen() === true, 'outside a browser counts as on screen (server and scripts)')
let ran = 0
whenVisible(() => ran++)()
check(ran === 1, 'a visible tick runs')
for (const p of ['src/components/field/clock-panel.tsx', 'src/components/field/network-notice.tsx', 'src/components/field/outbox-banner.tsx', 'src/components/field/report-files.tsx']) {
  check(/everyWhileVisible\(/.test(read(p)), `${p}: its timer skips ticks in the background and runs on return`)
}
check(/whenVisible\(\(\) => void recheck\(\)\)/.test(read('src/components/field/background-gate.tsx')), 'the setup card re-checks only while on screen')

// Downloaded when needed, ready offline.
const panel = read('src/components/field/clock-panel.tsx')
check(!/^import \{ CameraCapture \}/m.test(panel) && /const CameraCapture = dynamic\(loadCamera/.test(panel) && /useEffect\(\(\) => preloadClockParts\(\), \[\]\)/.test(panel),
  'the camera and pop-ups load after the page, fetched when idle (kept by the service worker for offline)')
check(/\{opening !== null && \(\s*<CameraCapture/.test(panel), 'the camera is only mounted while it is open')
check(/NamePlaceLazy/.test(read('src/app/field/layout.tsx')) && !/import \{ NamePlace[ ,]/.test(read('src/app/field/layout.tsx')),
  '"name this place" is not in every staff page\'s download')
check(/_next\/static/.test(read('public/sw.js')), 'the service worker keeps the app\'s files, so lazy parts work offline once fetched')

// The clock-in answers before the pushes go out.
const att = read('src/app/api/attendance/route.ts')
check(/after\(\(\) => flushFlagAlerts\(\)\)/.test(att) && /after\(\(\) => notifyWatchers\(alert\)\)/.test(att) && /await Promise\.all\(\s*signals\.map/.test(att),
  'clock-in records its checks together and sends alerts after answering')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL EFFICIENCY CHECKS PASSED')
