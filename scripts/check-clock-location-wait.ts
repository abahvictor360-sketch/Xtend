/**
 * Checks that clock-in never sits on "Getting your location…" for long
 * inside a shop: the phone app's own reading is capped and the browser's
 * network-location fallback takes over, the camera says it is waiting (and
 * how to help) instead of a greyed button under "are rejected", and the
 * Android plugin asks GPS and network together.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-clock-location-wait.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { NATIVE_FIRST_WAIT_MS } from '@/lib/geo'

let failed = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`)
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const geo = read('src/lib/geo.ts')
check(NATIVE_FIRST_WAIT_MS > 0 && NATIVE_FIRST_WAIT_MS <= 8000, 'the app waits at most 8 s for its own first reading')
check(/await within\(getNativeFix\(\), wait\)/.test(geo), 'every native reading is capped')
check(/\(await nativeReadings\(o\)\) \?\? \(await browserReadings\(o\)\)/.test(geo), 'with nothing from the app, the browser readings take over')
check(/enableHighAccuracy: false/.test(geo), 'the browser readings fall back to the quick network location')

const cam = read('src/components/field/camera-capture.tsx')
check(/Finding your location\. The button turns on as soon as it is found\./.test(cam), 'the camera says it is waiting for the location')
check(/Move near the door or a window/.test(cam) && /HELD_LONG_MS = 10_000/.test(cam), 'after 10 s it says how to help')
check(!/are\s+rejected/.test(cam), 'the camera no longer says photos "are rejected"')

const java = read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/LocationIntegrity.java')
check(/providers\.add\(LocationManager\.GPS_PROVIDER\)/.test(java) && /providers\.add\(LocationManager\.NETWORK_PROVIDER\)/.test(java)
  && /for \(String provider : providers\)/.test(java), 'the Android app asks GPS and network together')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL CLOCK LOCATION WAIT CHECKS PASSED')
