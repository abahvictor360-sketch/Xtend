import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Location is a must before and at every clock-in, clock-out, store check-in
 * and store check-out. This reads the code that enforces it, so a change
 * that drops one of the steps fails here.
 */
const root = join(__dirname, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok: ${name}`)
}

/** The text of the function or callback that starts at `marker`, up to the next one at its level. */
function block(source: string, marker: string) {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `missing ${marker}`)
  const next = source.indexOf('\n  const ', start + marker.length)
  return source.slice(start, next < 0 ? undefined : next)
}

const home = read('src/components/field/field-home.tsx')
const clock = read('src/components/field/clock-panel.tsx')
const visits = read('src/components/field/store-visits.tsx')
const gate = read('src/components/field/use-location-gate.ts')

// Before: the buttons are not shown until location is on.
check('before: the clock button sits inside the location gate', () => {
  assert.match(home, /<LocationGate[\s\S]*?>\s*<ClockPanel[\s\S]*?<\/LocationGate>/)
})
check('before: the store check-in and check-out buttons sit inside the location gate', () => {
  assert.match(home, /<LocationGate[\s\S]*?>\s*<StoreVisits[\s\S]*?<\/LocationGate>/)
})
check('before: the clock panel also blocks while the phone’s location is off', () => {
  assert.match(clock, /locationGate\.status === 'blocked' \? \(\s*<LocationGate/)
  assert.match(clock, /probe === 'off'/)
})
check('before: the gate needs a live, accurate fix and re-checks when Xtend comes back', () => {
  assert.match(gate, /await requireFix\(\)/)
  assert.match(gate, /visibilitychange/)
})

// At the moment of each action: a fresh, accurate fix, or nothing is sent.
check('clock in and out: a fresh fix before the camera opens', () => {
  assert.match(block(clock, 'const start = useCallback'), /await requireFix\(\)/)
})
check('clock in and out: read again if the camera was left open', () => {
  assert.match(block(clock, 'const onSelfie = useCallback'), /STALE_FIX_MS[\s\S]*?await requireFix\(\)/)
})
check('store check-in: a fresh fix before the camera opens', () => {
  assert.match(block(visits, 'const beginCheckIn = useCallback'), /await requireFix\(\)/)
})
check('store check-in: read again if the camera was left open', () => {
  assert.match(block(visits, 'const checkIn = useCallback'), /STALE_FIX_MS[\s\S]*?await requireFix\(\)/)
})
check('store check-out: a fresh fix at the tap', () => {
  assert.match(block(visits, 'const checkOut = useCallback'), /await requireFix\(\)/)
})
check('the fix is refused when it is not accurate enough', () => {
  const geo = read('src/lib/geo.ts')
  assert.match(geo, /export const ACCURACY_CEILING_M = 100/)
  assert.match(geo, /'low_accuracy'/)
})

// The server refuses any of the four without a position.
for (const [name, path] of [
  ['clock in and out', 'src/app/api/attendance/route.ts'],
  ['store check-in', 'src/app/api/visits/route.ts'],
  ['store check-out', 'src/app/api/visits/[id]/end/route.ts'],
] as const) {
  check(`server: ${name} needs lat, lng and accuracy`, () => {
    const route = read(path)
    assert.match(route, /lat: z\.number\(\)\.min\(-90\)\.max\(90\),/)
    assert.match(route, /lng: z\.number\(\)\.min\(-180\)\.max\(180\),/)
    assert.match(route, /accuracy_m: z\.number\(\)\.nonnegative\(\),/)
    assert.doesNotMatch(route, /lat: z\.number\(\)[^\n]*\.(optional|nullable)\(\)/)
  })
}

console.log(`ALL ${passed} LOCATION-REQUIRED CHECKS PASSED`)
