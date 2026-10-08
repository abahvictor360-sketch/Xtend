/**
 * Checks how GPS readings are combined and compared (src/lib/geo.ts). Needs
 * no phone and no database.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-geo.ts
 */
import { combineFixes, fixesAgree, haversineMetres, type Fix } from '@/lib/geo'

let failed = 0
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}`)
  if (!ok) failed++
}

const at = (lat: number, lng: number, accuracy_m: number, s = 0): Fix => ({
  lat,
  lng,
  accuracy_m,
  captured_at: new Date(Date.UTC(2026, 9, 8, 9, 0, s)).toISOString(),
  altitude: null,
  altitude_accuracy: null,
  speed: null,
  heading: null,
})

// The true spot, and readings around it: a rough first guess (a cell
// tower), then the GPS chip locking on.
const spot = { lat: 6.5244, lng: 3.3792 }
const readings = [
  at(6.5262, 3.3810, 180, 0), // cell tower, 270 m off
  at(6.52446, 3.37925, 14, 2),
  at(6.52438, 3.37916, 9, 4),
  at(6.52441, 3.37921, 8, 6),
]
const fix = combineFixes(readings)!
check(fix.samples === 4 && fix.used === 3, 'the rough first reading is left out')
check(haversineMetres(fix.lat, fix.lng, spot.lat, spot.lng) < 8, 'the combined position is within 8 m of the spot')
check(fix.accuracy_m >= 8 && fix.accuracy_m < 15, 'it claims no better than the best reading, nor worse than the scatter')
check(fix.captured_at === readings[3].captured_at, 'it is stamped with the latest reading used')

const one = combineFixes([at(6.5, 3.3, 40)])!
check(one.used === 1 && one.accuracy_m === 40 && one.spread_m === 0, 'one reading is kept as it is')
check(combineFixes([]) === null, 'no readings, no position')

check(fixesAgree(at(6.5244, 3.3792, 10), at(6.52445, 3.37925, 10)).agree, 'readings 8 m apart agree')
check(!fixesAgree(at(6.5244, 3.3792, 10), at(6.5254, 3.3792, 10)).agree, 'readings 110 m apart do not')
check(fixesAgree(at(6.5244, 3.3792, 60), at(6.5250, 3.3792, 60)).agree, 'rough readings are allowed more room')

if (failed) {
  console.log(`\n${failed} FAILED`)
  process.exit(1)
}
console.log('\nALL GEO CHECKS OK')
