/**
 * Checks staff are told when the network is the problem: the connection is
 * read as offline, weak or fine; a request that never reached the server, or
 * a location that failed on a bad network, opens the right pop-up; and Home
 * shows a live "No network" / "Your network is weak" notice.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-network-notice.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { guideFor, isNetworkError, networkQuality, problemFromGeo, problemFromMessage } from '@/lib/field-guide'

let failed = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`)
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

check(networkQuality({ onLine: false }) === 'offline', 'no connection is offline')
check(networkQuality({ onLine: true, effectiveType: '2g' }) === 'weak' && networkQuality({ onLine: true, effectiveType: 'slow-2g' }) === 'weak', '2G is weak')
check(networkQuality({ onLine: true, rtt: 2000 }) === 'weak' && networkQuality({ onLine: true, downlink: 0.1 }) === 'weak', 'slow replies or a trickle of data is weak')
check(networkQuality({ onLine: true, effectiveType: '4g', rtt: 100, downlink: 5 }) === 'ok' && networkQuality({ onLine: true }) === 'ok', '4G, or nothing known, is fine')

check(isNetworkError(new TypeError('Failed to fetch')) && isNetworkError(new Error('Load failed')) && isNetworkError(new Error('The operation timed out')),
  'a request that never got through is a network error')
check(!isNetworkError(new Error('Pick the store you are starting at')), 'a refusal from the server is not')
check(problemFromMessage('Failed to fetch') === 'no_network' && problemFromMessage('No connection') === 'no_network', 'a dropped request opens "Your network is not working"')
check(problemFromMessage('No stores are allocated to you yet') === 'no_stores', 'server refusals still open their own pop-up')

check(problemFromGeo('position_unavailable', 'offline') === 'location_no_network' && problemFromGeo('low_accuracy', 'weak') === 'location_no_network',
  'a location that fails on a bad network says the network is the cause')
check(problemFromGeo('position_unavailable', 'ok') === 'location_off' && problemFromGeo('permission_denied', 'offline') === 'location_permission',
  'a good network, or location not allowed, keeps the setting steps')

for (const platform of ['android', 'ios'] as const) {
  const g = guideFor('no_network', platform)
  check(/Mobile data|Mobile Data/.test(g.steps.join(' ')) && /data on your line/.test(g.steps.join(' ')) && g.action === 'retry', `${platform}: the network pop-up says to turn on data, check the line has data, then try again`)
}
check(/Weak network/.test(guideFor('location_no_network', 'android').title), 'the location pop-up names the weak network')

const panel = read('src/components/field/clock-panel.tsx')
check((panel.match(/problemFromGeo\(err\.reason, currentNetwork\(\)\)/g) ?? []).length === 2 && panel.includes("setGuide('no_network')"), 'clock in and out read the network when location or the request fails')
check(panel.includes('To send it sooner: check Mobile data is on'), 'a clock-in saved on the phone says how to send it sooner')
const visits = read('src/components/field/store-visits.tsx')
check((visits.match(/problemFromGeo\(err\.reason, currentNetwork\(\)\)/g) ?? []).length === 4 && (visits.match(/if \(isNetworkError\(err\)\) setGuide\('no_network'\)/g) ?? []).length === 2,
  'store check-in and check-out do too')

const notice = read('src/components/field/network-notice.tsx')
check(notice.includes("'No network'") && notice.includes("'Your network is weak'") && notice.includes('Your network is back'), 'Home shows no network, weak network and back again')
check(notice.includes("addEventListener('offline'") && notice.includes("addEventListener?.('change'"), 'it reacts the moment the connection changes')
check(!/monitor|tracked|integrity|follow/i.test(notice), 'it never mentions monitoring')
check(read('src/components/field/field-home.tsx').includes('<NetworkNotice />') && read('src/components/field/xm-forms.tsx').includes('<NetworkNotice />'), 'it is on Home and the X Metrics forms')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL NETWORK NOTICE CHECKS PASSED')
