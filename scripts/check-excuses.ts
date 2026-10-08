/**
 * Checks how excuses are judged (src/lib/excuse.ts) on made-up evidence:
 * the three added in migration 048, and that the first two are unchanged.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-excuses.ts
 */
import { judgeExcuse, type ExcuseEvidence, type MoreEvidence } from '@/lib/excuse'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const T = (h: number, m = 0) => `2026-10-08T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z` // Lagos h:m
const base: ExcuseEvidence = {
  contacts: [], offline_records: [], offline_positions: [], before: null, after: null,
  place_before: null, place_after: null, phone_checks: [], has_push: true, ever_reported: true,
}
const empty: MoreEvidence = { stores: [{ name: 'Ikeja City Mall', radius_m: 150 }], positions: [], location_problems: [], photos_refused: [], queued: null, clock: [], visits: [] }
const pos = (h: number, acc: number, storeM: number, source: MoreEvidence['positions'][number]['source'] = 'tracking') =>
  ({ at: T(h), lat: 6.6, lng: 3.35, accuracy_m: acc, source, store: 'Ikeja City Mall', store_m: storeM, radius_m: 150 })
const heard = { ...base, contacts: [{ at: T(9, 5), what: 'app_open', battery_pct: 70, charging: false, connection: '4g', outbox_count: 0, lat: null, lng: null, clock_off_s: 0 }] }

// "My location would not work"
let v = judgeExcuse(base, 'gps_failed', { ...empty, positions: [pos(9, 12, 20), pos(10, 9, 30)] })
check(v.verdict === 'false' && /2 accurate positions/.test(v.headline), 'GPS: accurate positions say it worked', v)
v = judgeExcuse(base, 'gps_failed', { ...empty, location_problems: [{ at: T(9), kind: 'permission_denied', distance_m: null }] })
check(v.verdict === 'fits', 'GPS: a reported location failure fits', v)
v = judgeExcuse(base, 'gps_failed', { ...empty, positions: [pos(9, 450, 20)] })
check(v.verdict === 'fits' && /rougher than 100 m/.test(v.headline), 'GPS: only rough positions fits', v)
v = judgeExcuse(base, 'gps_failed', { ...empty, positions: [pos(9, 12, 20)], location_problems: [{ at: T(8), kind: 'low_accuracy', distance_m: null }] })
check(v.verdict === 'doubtful', 'GPS: a failure, then good positions, is doubtful', v)

// "I was at my store the whole time"
v = judgeExcuse(base, 'at_store', { ...empty, positions: [pos(9, 15, 40), pos(10, 20, 90), pos(11, 10, 120)] })
check(v.verdict === 'fits' && /all 3/.test(v.headline), 'Store: every position inside the fence fits', v)
v = judgeExcuse(base, 'at_store', { ...empty, positions: [pos(9, 15, 40), pos(10, 20, 2300), pos(11, 10, 60)] })
check(v.verdict === 'false' && /2\.3 km|2,300 m|2300/.test(v.headline), 'Store: a position 2.3 km away says not true', v)
v = judgeExcuse(base, 'at_store', { ...empty, positions: [pos(9, 15, 40), pos(10, 30, 330)] })
check(v.verdict === 'doubtful', 'Store: just outside the fence is doubtful', v)
v = judgeExcuse(base, 'at_store', { ...empty, positions: [pos(10, 400, 3000)] })
check(v.verdict === 'unknown', 'Store: a rough position proves nothing', v)
v = judgeExcuse(base, 'at_store', { ...empty, stores: [] })
check(v.verdict === 'unknown' && /has a location yet/.test(v.headline), 'Store: a store with no location cannot be judged', v)

// "The app would not let me clock in"
v = judgeExcuse(heard, 'app_failed', { ...empty, clock: [{ at: T(9, 10), type: 'opening', status: 'on_site', distance_m: 20 }] })
check(v.verdict === 'false', 'App: a clock-in that went through says not true', v)
v = judgeExcuse(heard, 'app_failed', { ...empty, photos_refused: [{ at: T(9, 6), kind: 'selfie', problem: 'screen', message: 'Take it of your face' }] })
check(v.verdict === 'fits' && /selfie was refused/.test(v.headline), 'App: a refused selfie fits', v)
v = judgeExcuse(heard, 'app_failed', empty)
check(v.verdict === 'doubtful', 'App: open with network and nothing in the way is doubtful', v)
v = judgeExcuse(base, 'app_failed', empty)
check(v.verdict === 'unknown', 'App: no sign of trying is unknown', v)

// The first two are unchanged, with or without the extra evidence.
check(judgeExcuse(heard, 'no_network').verdict === 'false' && judgeExcuse(heard, 'no_network', empty).verdict === 'false', 'no network: a phone heard from still says not true')
check(judgeExcuse(heard, 'phone_off', empty).verdict === 'false', 'phone off: a phone heard from still says not true')

if (failed) {
  console.log(`\n${failed} FAILED`)
  process.exit(1)
}
console.log('\nALL EXCUSE CHECKS OK')
