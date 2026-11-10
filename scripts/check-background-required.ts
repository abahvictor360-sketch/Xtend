/**
 * Checks the rule for when the phone app holds back clocking in or out
 * (src/lib/background-gate.ts): location must be "all the time" and, on
 * Android, battery saving must be off for Xtend; a browser or an app that
 * does not report a setting is never locked out.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-background-required.ts
 */
import { backgroundNeeds, type BackgroundState } from '@/lib/background-gate'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}

const needs = (s: BackgroundState | null | undefined) => backgroundNeeds(s)

// Everything allowed: nothing held back.
check(!needs({ platform: 'android', always: true, batteryUnrestricted: true }).blocked, 'Android with both settings on is not held back')
check(!needs({ platform: 'ios', always: true, batteryUnrestricted: true }).blocked, 'iPhone with Always is not held back')

// Android: each setting alone holds the clock back, and says which.
const noAlways = needs({ platform: 'android', always: false, batteryUnrestricted: true })
check(noAlways.blocked && noAlways.always && !noAlways.battery, 'Android without "all the time": held back, location only', noAlways)
const noBattery = needs({ platform: 'android', always: true, batteryUnrestricted: false })
check(noBattery.blocked && !noBattery.always && noBattery.battery, 'Android with battery saving on: held back, battery only', noBattery)
const neither = needs({ platform: 'android', always: false, batteryUnrestricted: false })
check(neither.blocked && neither.always && neither.battery, 'Android with neither: both are asked for', neither)

// iPhone: Always is needed, and the battery setting never is.
const iosNoAlways = needs({ platform: 'ios', always: false, batteryUnrestricted: true })
check(iosNoAlways.blocked && iosNoAlways.always && !iosNoAlways.battery, 'iPhone without Always: held back, location only', iosNoAlways)
check(!needs({ platform: 'ios', always: true, batteryUnrestricted: false }).blocked, 'iPhone is never held back for the battery setting')

// Nobody is locked out when the phone cannot say.
check(!needs(null).blocked, 'a browser (no state) is never held back')
check(!needs(undefined).blocked, 'no state at all is never held back')
check(!needs({}).blocked, 'an app that reports nothing is never held back')
check(!needs({ platform: 'android' }).blocked, 'Android that does not report the settings is never held back')
check(!needs({ platform: 'android', always: true }).blocked, 'an older app that omits the battery setting is not held back for it')
check(!needs({ platform: 'android', batteryUnrestricted: true }).blocked, 'an older app that omits "all the time" is not held back for it')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL BACKGROUND REQUIRED CHECKS PASSED')
