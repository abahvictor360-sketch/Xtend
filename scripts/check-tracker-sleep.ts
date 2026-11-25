/**
 * Checks the phone trackers keep sending movement (2026-11-25): an Android
 * phone asleep still ticks (an alarm allowed while idle, which also
 * restarts a stopped tracker), a stale position is replaced by a fresh one,
 * positions saved offline are never thrown away, and after clock-out
 * nothing new is collected while what was saved is still sent.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-tracker-sleep.ts
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

const svc = read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTrackerService.java')
check(/setAndAllowWhileIdle\(AlarmManager\.ELAPSED_REALTIME_WAKEUP/.test(svc) && /scheduleTick\(this\);\s*return START_STICKY;/.test(svc),
  'Android: every tick is also an alarm allowed while the phone sleeps')
check(/ACTION_TICK\.equals\(intent\.getAction\(\)\)/.test(svc) && /PendingIntent\.getForegroundService/.test(svc), 'the alarm restarts a stopped tracker and runs a tick')
check(/freshFix\(best\)/.test(svc) && /requestLocationUpdates\(provider, 0L, 0f, once/.test(svc) && /tickLock\.acquire/.test(svc),
  'a stale position is replaced by a fresh one, with the phone kept awake for it')
check(!/putString\("queue", "\[\]"\)/.test(svc), 'Android never empties the saved positions')
check(/if \(!collecting\(this\)\) return;/.test(svc) && /static void finish\(Context context\)/.test(svc) && /draining\(this\)/.test(svc),
  'Android: after clock-out nothing new is collected; saved positions are still sent')
const plugin = read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTracker.java')
check(/ShiftTrackerService\.finish\(getContext\(\)\)/.test(plugin) && /o\.put\("drains", true\)/.test(plugin), 'Android stop drains rather than drops')
check(/draining\(context\)/.test(read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTrackerBoot.java')),
  'after a restart the tracker resumes to send what is waiting')

const ios = read('mobile/ios/App/App/ShiftTracker.swift')
check(/manager\.distanceFilter = kCLDistanceFilterNone\n/.test(ios), 'iPhone: standing still still gives positions')
check(!/defaults\.set\(\[\], forKey: self\.queueKey\)/.test(ios) && /func finish\(\)/.test(ios) && /"drains": true/.test(ios),
  'iPhone: saved positions are never thrown away; stop drains')

const native = read('src/lib/native.ts')
check(/state\.drains \|\| state\.queued === 0/.test(native), 'the app stops a draining build at clock-out, and leaves an older one running while it has positions')
check(/new Date\(Math\.min\(pos\.timestamp/.test(read('src/components/field/heartbeat.ts')), 'an offline position from the page keeps the time it was taken')
check(/0096/.test(read('supabase/migrations/0096_every_synced_position_kept.sql')) && /late := true;/.test(read('supabase/migrations/0096_every_synced_position_kept.sql')),
  'the server keeps positions from an ended token (0096)')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL TRACKER SLEEP CHECKS PASSED')
