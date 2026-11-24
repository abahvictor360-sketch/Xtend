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
check(/nextType === 'opening' && startStores \? setPicking\(true\)/.test(panel), 'Clock in asks for the store first, then opens the camera')
check(/xt-start-ask-/.test(panel) && /readyToAsk/.test(panel), 'opening Xtend before clocking in asks straight away (once a day)')
check(/setGuide\(why\)/.test(panel), 'clock-in refusals are explained step by step')
const sheet = read('src/components/field/start-store-sheet.tsx')
check(/today does not count/.test(sheet) && /Google Maps link/.test(sheet) && /Message the office/.test(sheet), 'the picker says the day only counts from a store, and what to do with no stores')
check(/my_outlets/.test(read('src/app/field/page.tsx')), 'the picker lists their own stores (home and allocated)')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL START STORE CHECKS PASSED')
