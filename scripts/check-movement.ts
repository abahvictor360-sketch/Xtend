/**
 * Checks how a day of positions becomes a journey (src/lib/movement.ts):
 * stops, travel, silences, time off after clocking out, and impossible jumps.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-movement.ts
 */
import { journey, mergeTrails, type PointKind, type Trail, type TrailPoint } from '@/lib/movement'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const T = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h - 1, m)).toISOString() // Lagos h:m
const mall = { id: 'mall', name: 'Ikeja City Mall', lat: 6.6018, lng: 3.3515, radius_m: 150 }
const p = (at: string, lat: number, lng: number, kind: PointKind = 'location', acc = 15, place: string | null = null): TrailPoint =>
  ({ at, kind, lat, lng, accuracy_m: acc, distance_m: null, place, outlet_id: null })

// 08:00 clock in at the mall, there till 10:00, drive ~5 km to a market (20 min),
// stay 40 min, silent 45 min, back at the mall, clock out at 17:00.
const points: TrailPoint[] = [
  p(T(8, 8), 6.6018, 3.3515, 'clock_in'),
  ...[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => p(T(8, 8, m), 6.6019, 3.3516)),
  ...[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => p(T(8, 9, m), 6.6017, 3.3514)),
  p(T(8, 10, 0), 6.6018, 3.3515),
  p(T(8, 10, 5), 6.5900, 3.3600), // travelling
  p(T(8, 10, 9), 6.5900, 3.3600, 'location', 900), // rough: ignored
  p(T(8, 10, 12), 6.5750, 3.3700),
  p(T(8, 10, 20), 6.5600, 3.3800, 'location', 20, 'Oshodi Market'),
  ...[25, 30, 35, 40, 45, 50, 55].map((m) => p(T(8, 10, m), 6.5601, 3.3801, 'location', 20, 'Oshodi Market')),
  p(T(8, 11, 0), 6.5600, 3.3800, 'location', 20, 'Oshodi Market'),
  // nothing until 11:45
  p(T(8, 11, 45), 6.6018, 3.3515),
  p(T(8, 12, 0), 6.6018, 3.3515),
  p(T(8, 17, 0), 6.6018, 3.3515, 'clock_out'),
]
const day1: Trail = { person: null, date: '2026-10-08', points, stores: [mall] }
const j = journey(day1)
const kinds = j.legs.map((l) => l.kind).join(',')
check(kinds.startsWith('stop,move,stop,gap,stop'), 'a store stay, a drive, a market stay, a silence, back at the store', kinds)
const first = j.legs[0]
check(first.kind === 'stop' && first.inStore && first.name === 'Ikeja City Mall' && Math.round(first.minutes) === 120, 'two hours at the mall', first)
const drive = j.legs[1]
check(drive.kind === 'move' && drive.distanceM > 4000 && drive.distanceM < 7000, 'the drive is about 5 km', drive)
const market = j.legs[2]
check(market.kind === 'stop' && !market.inStore && market.name === 'Oshodi Market', 'the market is a stop outside their stores, named', market)
const gap = j.legs[3]
check(gap.kind === 'gap' && Math.round(gap.minutes) === 45, 'the 45-minute silence', gap)
check(j.totals.storeMinutes >= 120 && j.totals.elsewhereMinutes === 40 && j.totals.silentMinutes === 45 + 300, 'the day adds up (with five silent hours before clocking out)', j.totals)
check(j.stores.length === 1 && j.stores[0] === 'Ikeja City Mall', 'stores visited listed once', j.stores)
check(j.jumps.length === 0, 'no impossible jumps on a real drive', j.jumps)

// Day two: a reading in Abuja two minutes after Lagos.
const day2: Trail = {
  person: null,
  date: '2026-10-09',
  stores: [mall],
  points: [
    p(T(9, 8), 6.6018, 3.3515, 'clock_in'),
    p(T(9, 8, 2), 9.0765, 7.3986, 'location', 10, 'Wuse Market'),
    p(T(9, 8, 10), 6.6018, 3.3515),
  ],
}
const both = mergeTrails([day2, day1])
check(both.points[0].at === T(8, 8) && both.stores.length === 1, 'two days merge in time order, the store once')
const j2 = journey(both)
check(j2.legs.some((l) => l.kind === 'off'), 'the night after clocking out is time off, not a silence', j2.legs.map((l) => l.kind))
check(j2.jumps.length >= 1 && j2.jumps[0].toPlace === 'Wuse Market' && j2.jumps[0].kmh > 1000, 'Lagos to Abuja in two minutes is an impossible jump', j2.jumps)
check(journey({ person: null, date: '', points: [], stores: [] }).legs.length === 0, 'an empty day is an empty journey')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL MOVEMENT CHECKS PASSED')
