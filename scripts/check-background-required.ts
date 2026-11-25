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

// A phone that cannot report the battery setting: the person confirms it.
const confirmed = backgroundNeeds({ platform: 'android', always: true, batteryUnrestricted: false }, { batteryConfirmed: true })
check(!confirmed.blocked && !confirmed.battery, 'battery confirmed by the person: not held back for it', confirmed)
const confirmedNoLocation = backgroundNeeds({ platform: 'android', always: false, batteryUnrestricted: false }, { batteryConfirmed: true })
check(confirmedNoLocation.blocked && confirmedNoLocation.always && !confirmedNoLocation.battery, 'confirming the battery never waives location', confirmedNoLocation)

// Movement saved with no signal is always kept (0095): never dropped on the
// phone for its age, and the server keeps any position taken during a shift.
{
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  const sync = read('src/lib/offline/sync.ts')
  check(/if \(kind === 'ping'\) return Number\.POSITIVE_INFINITY/.test(sync) && /> maxAge\('ping'\)/.test(sync),
    'saved positions are kept on the phone until they are sent')
  const mig = read('supabase/migrations/0095_offline_movement_always_kept.sql')
  check(/not public\.ping_in_shift\(t\.user_id, taken\)/.test(mig) && !/taken < now\(\) - interval '24 hours'\s*\n\s*or taken < t\.created_at/.test(mig),
    'the server keeps positions taken during a shift, at any age, from any of their tokens')
  const m96 = read('supabase/migrations/0096_every_synced_position_kept.sql')
  check(!/ping_in_shift\(/.test(m96) && !/interval '24 hours'/.test(m96) && /late := true;/.test(m96)
        && /trg_attendance_claim_pings/.test(m96),
    'every synced position is kept, at any time, and a late clock-in takes in its day (0096)')
}

// TECNO, Infinix and itel: Auto-start and the lock, confirmed once on the phone.
{
  const { backgroundNeeds: needs, strictMaker } = require('@/lib/background-gate') as typeof import('@/lib/background-gate')
  const tecno = { platform: 'android', always: true, batteryUnrestricted: true, maker: 'tecno' }
  check(strictMaker(tecno) === 'TECNO' && strictMaker({ ...tecno, maker: 'infinix mobility' }) === 'Infinix' && strictMaker({ ...tecno, maker: 'itel' }) === 'itel',
    'TECNO, Infinix and itel phones are recognised')
  check(strictMaker({ ...tecno, maker: 'samsung' }) === null && strictMaker({ ...tecno, platform: 'ios' }) === null && strictMaker({ platform: 'android' }) === null,
    'other phones, iPhones and older app builds are not asked')
  check(needs(tecno).maker && needs(tecno).blocked, 'a TECNO phone is held until Auto-start and the lock are confirmed')
  check(!needs(tecno, { makerConfirmed: true }).blocked, 'once confirmed on the phone, it clears')
  const fs2 = require('node:fs') as typeof import('node:fs')
  const path2 = require('node:path') as typeof import('node:path')
  const gate = fs2.readFileSync(path2.join(__dirname, '..', 'src/components/field/background-gate.tsx'), 'utf8')
  check(gate.includes('Open Auto-start') && gate.includes('until a lock shows') && gate.includes('I did both') && !/monitor|tracked|follow/i.test(gate),
    'the card gives both steps, a button for Auto-start and a confirmation, and never mentions monitoring')
  const java = fs2.readFileSync(path2.join(__dirname, '..', 'mobile/android/app/src/main/java/ng/xpelbeauty/xtend/ShiftTracker.java'), 'utf8')
  check(java.includes('public void openAutoStart(PluginCall call)') && java.includes('com.transsion.phonemaster') && java.includes('o.put("maker"'),
    'the app reports the maker and opens Phone Master’s Auto-start screen')
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL BACKGROUND REQUIRED CHECKS PASSED')
