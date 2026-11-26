/**
 * "Check out before you leave" (2026-11-26): the phone rings like an alarm
 * when a marketer leaves the store they are checked in at without checking out.
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-visit-leave.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEAVE_ALARM, PLACE_RADIUS_M, leaveAlarmBody, leftTheStore, openVisitForPhone } from '@/lib/visit-leave'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok  : ${label}`)
  else {
    failed++
    console.log(`FAIL: ${label}`, got ?? '')
  }
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const store = openVisitForPhone({
  id: 'v1', outlet_lat: 6.6, outlet_lng: 3.35, outlet_radius_m: 120, arrived_lat: 6.6001, arrived_lng: 3.3501,
  arrived_place_name: 'Shop door', outlets: { name: 'Roban Store' },
})
check(store?.name === 'Roban Store' && store.lat === 6.6 && store.radius_m === 120, 'a store visit: the store\'s spot and area', store)
const place = openVisitForPhone({
  id: 'v2', outlet_lat: null, outlet_lng: null, outlet_radius_m: null, arrived_lat: 6.5, arrived_lng: 3.3,
  arrived_place_name: 'Mama Put Shop', outlets: null,
})
check(place?.name === 'Mama Put Shop' && place.lat === 6.5 && place.radius_m === PLACE_RADIUS_M,
  'a visit at a place that is not a store: watched around where they checked in', place)
check(openVisitForPhone(null) === null, 'no open visit: nothing to watch')

check(leftTheStore(200, 120, 10) === true, 'outside the area: ring')
check(leftTheStore(125, 120, 10) === false, 'at the edge, within the phone\'s accuracy: not yet')
check(leftTheStore(160, 120, 60) === false, 'up to 50 m of accuracy is allowed for')
check(leftTheStore(500, 120, 150) === null, 'a reading rougher than 100 m says nothing')
check(leaveAlarmBody('Roban Store') === 'You are leaving Roban Store without checking out. Go back and check out there.',
  'the words name the store and say what to do')

const android = read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTrackerService.java')
const ios = read('mobile/ios/App/App/ShiftTracker.swift')
for (const [name, src] of [['Android', android], ['iPhone', ios]] as const) {
  check(src.includes(`"${LEAVE_ALARM.title}"`) && src.includes(LEAVE_ALARM.end.trim()), `${name} rings with the same words`)
}
check(/FLAG_INSISTENT/.test(android) && /USAGE_ALARM/.test(android) && /TYPE_ALARM/.test(android) && /setVibrationPattern/.test(android),
  'Android rings like an alarm: alarm sound, repeating until opened, vibrating')
check(/LEAVE_RING_AGAIN_MS = 2 \* 60_000/.test(android) && /!leaveAlarmShowing\(\)/.test(android),
  'Android rings again two minutes after it is dismissed, while they are still outside')
check(/d\[0\] > radius \+ Math\.min\(acc, 50f\)/.test(android) && /acc > 100f/.test(android), 'Android uses the same rule')
check(/VISIT_EVERY_MS = 20_000/.test(android) && /VISIT_EVERY_MS : 60_000/.test(android), 'Android checks every 20 seconds while checked in')
check(/checkLeaving\(l\);/.test(android) && /setVisit\(this, answer\.optJSONObject\("visit"\)\)/.test(android),
  'Android checks every position, and learns the open visit from the server')
check(/UNTimeIntervalNotificationTrigger\(timeInterval: 60, repeats: true\)/.test(ios) && /checkLeaving\(l\)/.test(ios),
  'iPhone rings again every minute until they check out or go back in')
check(/setVisit\(context, null\);/.test(android) && /setVisit\(nil\)/.test(ios), 'the end of the shift stops it on both phones')

check(/openVisitForPhone\(open as OpenVisitRow \| null\)/.test(read('src/app/api/track/device/route.ts')),
  'the tracker\'s answer names the open visit')
const visits = read('src/components/field/store-visits.tsx')
check(/void visitChanged\(\)/.test(visits) && /void visitChanged\(true\)/.test(visits), 'check-in and check-out tell the phone at once')
check(/void visitChanged\(\)/.test(read('src/components/field/clock-panel.tsx')), 'a marketer\'s clock-in (which checks them in) tells the phone too')
check(/visitChanged/.test(read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTracker.java'))
  && /name: "visitChanged"/.test(ios), 'both plugins take visitChanged')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL VISIT LEAVE CHECKS PASSED')
