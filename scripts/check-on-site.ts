/**
 * Checks "on site only" (0106): nobody clocks in or checks in at a store
 * from outside it. The phone stops them before the camera, names the store
 * and shows the way; the database refuses it anyway, with the same rule.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-on-site.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { directionsTo, distanceWords, offSite, offSiteFromServer, offSiteWords, tooFar } from '@/lib/on-site'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

check(tooFar(200, 150, 30) && !tooFar(170, 150, 30) && !tooFar(null, 150, 10) && tooFar(250, 150, 500) && !tooFar(150, 150, 0),
  'beyond the store area, allowing up to 50 m of the phone accuracy (as the database)')

const shop = { id: 's1', name: 'Onsite Shop', address: 'Allen Avenue, Ikeja', lat: 6.6, lng: 3.35, geofence_radius_m: 150 }
const far = { id: 's2', name: 'Faraway Shop', address: null, lat: 6.45, lng: 3.45, geofence_radius_m: 150 }
const away = offSite({ lat: 6.609, lng: 3.35, accuracy_m: 10 }, [shop, far])
check(away?.store.name === 'Onsite Shop' && away.distance_m > 950 && away.distance_m < 1050, 'away from all their stores: sent to the nearest', away)
check(offSite({ lat: 6.6005, lng: 3.35, accuracy_m: 10 }, [shop, far]) === null, 'inside the store: nothing stops them')
check(offSite({ lat: 6.45, lng: 3.45, accuracy_m: 10 }, [shop, far], shop)?.store.name === 'Onsite Shop', 'a marketer at another store is sent to the store they picked')
check(offSite({ lat: 6.609, lng: 3.35, accuracy_m: 10 }, [shop, { ...far, lat: null, lng: null }]) === null,
  'a store still waiting for its location may be where they are: not stopped')
check(offSite({ lat: 6.609, lng: 3.35, accuracy_m: 10 }, []) === null, 'no stores: nothing to measure')
check(distanceWords(420.4) === '420 m' && distanceWords(1349) === '1.3 km', 'distances in words')
check(offSiteWords(away!, 'clock in') === 'You are off site: 1.0 km from Onsite Shop. Go to Onsite Shop (Allen Avenue, Ikeja), then clock in there.',
  'the words match the database', offSiteWords(away!, 'clock in'))
check(directionsTo(6.6, 3.35) === 'https://www.google.com/maps/dir/?api=1&destination=6.6,3.35', 'directions open in Google Maps')
const fromServer = offSiteFromServer({ code: 'off_site', error: 'x', off_site: { store: { id: 's1', name: 'Onsite Shop', address: null, lat: 6.6, lng: 3.35 }, distance_m: 990, radius_m: 150 } })
check(fromServer?.store.name === 'Onsite Shop' && fromServer.distance_m === 990 && offSiteFromServer({ error: 'other' }) === null,
  "the server's refusal is read back into the store to go to")

const m = read('supabase/migrations/0106_on_site_only.sql')
check(/least\(greatest\(coalesce\(p_accuracy, 0\), 0\), 50\)/.test(m) && /using hint = 'off_site'/.test(m), 'the database uses the same rule and says off_site')
check(/new\.type <> 'opening'/.test(m) && /when \(not public\.office_entry_on\(\)\)/.test(m), 'clock-outs and office entries are never refused')
check(/block_off_site boolean not null default true/.test(m), 'on by default, and the office can turn it off')
check(read('src/app/api/attendance/route.ts').includes('offSiteRefusal(error)') && read('src/app/api/visits/route.ts').includes('offSiteRefusal(error)'),
  'both routes pass the store on to the app')
const panel = read('src/components/field/clock-panel.tsx')
check(/offSiteFrom\(fix, sites\.current, startStore\.current\)/.test(panel) && panel.includes('<OffSiteSheet') && panel.includes('offSiteFromServer(err.body)'),
  'clock-in: stopped before the camera, and the server refusal shows the same pop-up')
const visits = read('src/components/field/store-visits.tsx')
check(visits.includes('<OffSiteSheet') && visits.includes('offSiteFromServer(data)') && /offSiteFrom\(fix, \[\], outlet\)/.test(visits), 'store check-in too')
const sheet = read('src/components/field/off-site-sheet.tsx')
check(sheet.includes('You are off site') && sheet.includes('directionsTo(') && sheet.includes('I am at the store') && !/monitor|tracked|integrity/i.test(sheet),
  'the pop-up names the store, shows the way, lets them retry, and never mentions monitoring')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL ON SITE CHECKS PASSED')
