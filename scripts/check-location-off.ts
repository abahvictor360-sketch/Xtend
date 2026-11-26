/**
 * Location turned off during a shift (migration 0115).
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-location-off.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locationOffAlert, TURN_LOCATION_ON } from '@/lib/location-off-words'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok  : ${label}`)
  else {
    failed++
    console.log(`FAIL: ${label}`, got ?? '')
  }
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const a = locationOffAlert({ name: 'Ada Okafor', since: '10:42', minutes: 18, lastPlace: 'Roban Store', lastAt: '10:30' })
check(a.title === "Ada Okafor's location is off", 'the supervisor is told whose location is off', a)
check(/turned off location at 10:42/.test(a.body) && /18 min/.test(a.body) && /Last seen at Roban Store at 10:30/.test(a.body)
  && /Call them/.test(a.body), 'it says since when, for how long, where they were last seen, and what to do', a)
const b = locationOffAlert({ name: 'Ada', since: '10:42', minutes: 15, lastPlace: null, lastAt: null })
check(!/Last seen/.test(b.body), 'with no position before, it does not make one up', b)

// The phone's request, word for word on Android and iPhone; nothing about who is told.
const android = read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTrackerService.java')
const ios = read('mobile/ios/App/App/ShiftTracker.swift')
check(android.includes(`"${TURN_LOCATION_ON.title}"`) && android.includes(`"${TURN_LOCATION_ON.body}"`),
  'Android asks "Turn your location back on"')
check(ios.includes(`"${TURN_LOCATION_ON.title}"`), 'iPhone asks "Turn your location back on"')
check(!/supervisor|monitor|alert|track/i.test(TURN_LOCATION_ON.title + TURN_LOCATION_ON.body),
  'the request to staff says nothing about being watched')
check(/ACTION_LOCATION_SOURCE_SETTINGS/.test(android), 'on Android, tapping it opens the location settings')
check(/LocationManagerCompat\.isLocationEnabled/.test(android) && /onProviderDisabled[\s\S]{0,120}checkLocationState/.test(android)
  && /checkLocationState\(\);\s*long last = prefs/.test(android),
  'Android notices it at once and checks again on every tick')
check(/loc\.put\("off_since", iso\(offSince\)\)/.test(android) && /loc\.put\("on_at", iso\(onAt\)\)/.test(android),
  'Android sends off_since while off, and on_at once when back on')
check(/payload\["location"\] = \["off_since"/.test(ios) && /\.denied, \.restricted: return false/.test(ios),
  'iPhone sends the same, from its location permission')
check(/remove\("loc_off_since"\)/.test(android) && /removeObject\(forKey: "xtend\.tracker\.offSince"\)/.test(ios),
  'the end of the shift forgets it on both phones')

const device = read('src/app/api/track/device/route.ts')
check(/record_location_state/.test(device) && /p_off_since: state\.off_since/.test(device), 'the tracker route records it')
check(/await flushLocationOffAlerts\(\)/.test(read('src/app/api/cron/alerts/route.ts')), 'the five-minute job tells supervisors')
const movement = read('src/app/admin/tracking/page.tsx')
check(/Location off since/.test(movement) && /Location turned off/.test(movement) && /LocationOffSetting/.test(movement),
  'Movement shows who has location off now, each time it was off, and the admin\'s minutes')
check(!/supervisor|alert/i.test(read('src/components/staff-guide.tsx').match(/Turn your location back on[\s\S]{0,400}/)?.[0] ?? ''),
  'the staff guide says what to do, not who is told')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL LOCATION OFF CHECKS PASSED')
