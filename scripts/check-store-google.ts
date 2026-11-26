/**
 * Checking a store with Google before "off site" (migration 0114).
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-store-google.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { googleAgrees, needsLookup, AGREE_WITHIN_M } from '@/lib/store-check'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok  : ${label}`)
  else {
    failed++
    console.log(`FAIL: ${label}`, got ?? '')
  }
}

const shop = { lat: 6.4, lng: 7.495, name: 'Roban Store', address: '50 Agbani Rd' }
const near = { lat: 6.4012, lng: 7.4955, type: 'RANGE_INTERPOLATED', address: '50 Agbani Rd' }
const farAway = { lat: 6.44, lng: 7.51, type: 'ROOFTOP', address: 'Ogui Rd' }

check(AGREE_WITHIN_M === 300, 'Places and Geocoding must agree within 300 m')
check(JSON.stringify(googleAgrees({ places: shop, geocode: near }, '50 Agbani Rd')) === JSON.stringify({ lat: 6.4, lng: 7.495 }),
  'both answers agree: the shop Places found is the spot')
check(googleAgrees({ places: shop, geocode: farAway }, '50 Agbani Rd') === null,
  'another branch of the chain (the address is elsewhere): not confirmed')
check(googleAgrees({ places: shop, geocode: null }, '50 Agbani Rd') === null, 'Places alone is not enough')
check(googleAgrees({ places: null, geocode: { ...near, type: 'ROOFTOP' } }, '50 Agbani Rd')?.lat === 6.4012,
  'no shop found, but the address pinned to the building: confirmed')
check(googleAgrees({ places: null, geocode: { ...near, type: 'APPROXIMATE' } }, '50 Agbani Rd') === null,
  'a rough address (the town or street): not confirmed')
check(googleAgrees({ places: shop, geocode: near }, '  ') === null, 'a store with no address is never confirmed')

const now = Date.parse('2026-11-26T12:00:00Z')
const saved = { name_used: 'Roban Store', address_used: '50 Agbani Rd', confirmed: true, looked_up_at: '2026-11-20T12:00:00Z' }
const store = { name: 'Roban Store', address: '50 Agbani Rd' }
check(needsLookup(null, store, now), 'never asked: ask Google')
check(!needsLookup(saved, store, now), 'asked last week: the saved answer is used, no new charge')
check(needsLookup(saved, { ...store, address: '12 New Rd' }, now), 'a changed address: ask again')
check(needsLookup(saved, { ...store, name: 'Roban Superstore' }, now), 'a changed name: ask again')
check(needsLookup({ ...saved, looked_up_at: '2026-08-01T12:00:00Z' }, store, now), 'after 90 days: ask again')
check(needsLookup({ ...saved, confirmed: false, looked_up_at: '2026-11-18T12:00:00Z' }, store, now)
  && !needsLookup({ ...saved, confirmed: false, looked_up_at: '2026-11-24T12:00:00Z' }, store, now),
  'an answer that did not confirm it: asked again after a week, not before')

{
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  for (const route of ['src/app/api/attendance/route.ts', 'src/app/api/visits/route.ts']) {
    const src = read(route)
    check(/worthAskingGoogle\(error, input\)/.test(src) && /\(\{ data, error \} = await insert\(\)\)/.test(src)
      && /tellOfficeToCheckPin\(store\)/.test(src),
      `${route}: off site by the pin asks Google, sends it again once, and tells the office`)
  }
  for (const panel of ['src/components/field/clock-panel.tsx', 'src/components/field/store-visits.tsx']) {
    check(/away && !\(await googleSaysAtStore\(away\.store\.id, fix\)\)/.test(read(panel)),
      `${panel}: the phone asks Google before showing "You are off site"`)
  }
  const helper = read('src/lib/store-google.ts')
  check(/if \(!answer\) return null/.test(helper) && /p_confirmed: spot != null/.test(helper),
    'with no Google key or over the month\'s limit nothing is saved; only an agreed answer is confirmed')
  check(!/Google('s)? (spot|check|confirm|puts)/i.test(read('src/components/field/off-site-sheet.tsx') + read('src/components/staff-guide.tsx')),
    'staff are not told how the location is checked')
  check(/Use Google's spot/.test(read('src/components/admin/outlet-manager.tsx')), 'Outlets offers to move the pin to Google\'s spot')
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL STORE GOOGLE CHECKS PASSED')
