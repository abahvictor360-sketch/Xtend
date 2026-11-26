/**
 * Checks a marketer's start of day (0101): pick the store, then the camera,
 * and the clock-in is the check-in; no clocking in from home; with no
 * stores, what to send the office; every refusal explained step by step
 * with the staff guide. The database rules are tested in rules.sql.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-start-store.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { guideFor, problemFromMessage, STAFF_GUIDE_HREF } from '@/lib/field-guide'
import { matchStartStore, nearestStore } from '@/lib/start-store-match'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const mig = read('supabase/migrations/0101_start_day_at_a_store.sql')
const msgs = [...mig.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
check(msgs.length >= 3, 'the database explains each refusal', msgs)
for (const m of msgs) check(problemFromMessage(m) !== null, `the app turns "${m.slice(0, 40)}…" into steps`)
check(problemFromMessage('Turn on Xtend notifications before clocking in') === 'notifications_off', 'notifications off')
check(problemFromMessage('That selfie was rejected. Take a new one, live, of your face') === 'selfie_refused', 'a refused selfie')
check(problemFromMessage('Invalid capture timestamp') === 'phone_clock', 'a wrong phone clock')
check(problemFromMessage('something we have never seen') === null, 'anything else shows the plain message')
const noStores = guideFor('no_stores', 'android')
check(/Google Maps/.test(noStores.steps.join(' ')) && noStores.action === 'message_office', 'no stores: send the office the stores and their Google Maps links')
check(guideFor('pick_store', 'android').action === 'pick_store' && guideFor('store_not_yours', 'ios').action === 'pick_store', 'pick a store, from the pop-up')
check(STAFF_GUIDE_HREF === '/field/guide' && /Read the staff guide/.test(read('src/components/field/guide-sheet.tsx')), 'every pop-up points to the staff guide')

check(/p\.role = 'marketer'/.test(mig) && /office_entry_on/.test(mig), 'marketers only, never the office recording a clock')
check(/store := public\.start_store_of\(new\.device_info\);/.test(mig) && /'source', 'clock_in'/.test(mig), 'the clock-in opens the store visit at the picked store')

const panel = read('src/components/field/clock-panel.tsx')
check(/start_store_id: startStore\.current\.id/.test(panel), 'the clock-in carries the store they picked')
check(/nextType === 'opening' && startStores \? void beginClockIn\(\)/.test(panel), 'Clock in finds the store first, then opens the camera')

// Matching the store from where they stand (2026-11-26).
{
  const stores = [
    { id: 'a', lat: 6.6, lng: 3.35, geofence_radius_m: 150 },
    { id: 'b', lat: 6.6013, lng: 3.35, geofence_radius_m: 150 },
    { id: 'c', lat: null, lng: null, geofence_radius_m: 150 },
  ]
  check(matchStartStore({ lat: 6.6001, lng: 3.35, accuracy_m: 10 }, stores)?.id === 'a', 'standing in a store of theirs: that store')
  check(matchStartStore({ lat: 6.6011, lng: 3.35, accuracy_m: 10 }, stores)?.id === 'b', 'in two stores\' areas: the nearest')
  check(matchStartStore({ lat: 6.61, lng: 3.35, accuracy_m: 10 }, stores) === null, 'in none of them: no match, they pick')
  check(matchStartStore({ lat: 6.6016, lng: 3.35, accuracy_m: 40 }, [stores[0]])?.id === 'a', 'up to 50 m of the phone\'s accuracy counts, as for "on site"')
  check(matchStartStore({ lat: 6.6, lng: 3.35, accuracy_m: 10 }, [stores[2]]) === null, 'a store waiting for its location cannot be matched')
  check(nearestStore({ lat: 6.61, lng: 3.35 }, stores)?.id === 'b', 'the nearest pinned store, for asking Google')
  check(/let store = matchStartStore\(fix, stores\)/.test(panel) && /googleSaysAtStore\(nearest\.id, fix\)/.test(panel)
    && /setNoMatch\(true\)\s*setPicking\(true\)/.test(panel),
    'matched: straight to the camera; else Google is asked about the nearest; else they pick')
  check(/void start\('opening', fix\)/.test(panel), 'the position used to match is the one the clock-in sends')
  check(/startStores!\.length === 0 && nextType === 'opening'/.test(panel),
    'opening Xtend with no store allocated says so at once')
  const sheet = read('src/components/field/start-store-sheet.tsx')
  check(/Ask your admin to allocate a store to you\. You can clock in once a store is allocated\./.test(sheet)
    && /Your location does not match any of your stores\. Pick the store you are at\./.test(sheet),
    'the words: no store allocated, ask the admin; no match, pick the store')
}
check(/xt-start-ask-/.test(panel) && /readyToAsk/.test(panel), 'opening Xtend before clocking in asks straight away (once a day)')
check(/setGuide\(why\)/.test(panel), 'clock-in refusals are explained step by step')
const sheet = read('src/components/field/start-store-sheet.tsx')
check(/today does not count/.test(sheet) && /Google Maps link/.test(sheet) && /Message the admin/.test(sheet), 'the picker says the day only counts from a store, and what to do with no stores')
check(/my_outlets/.test(read('src/app/field/page.tsx')), 'the picker lists their own stores (home and allocated)')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL START STORE CHECKS PASSED')
