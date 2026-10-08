/**
 * Checks the pure parts of the audit log (migration 049): reading the
 * device from a browser string, the browser location cookie, the action
 * labels and the "new device / new location" marks.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-audit.ts
 */
import { parseUserAgent, readBrowserLocation } from '@/lib/audit-context'
import { actionLabel, markNew, parseAuditFilter, type AuditEntry } from '@/lib/audit-log'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const android = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.127 Mobile Safari/537.36'
const app = `${android} XtendApp`
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ipad = 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.67'
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:130.0) Gecko/20100101 Firefox/130.0'

let d = parseUserAgent(android)
check(d?.type === 'phone' && d.os === 'Android 14' && d.browser === 'Chrome 128' && !d.app, 'Android Chrome phone', d)
d = parseUserAgent(app)
check(d?.app === true && d.browser === 'Xtend app' && d.os === 'Android 14', 'the Xtend app is told apart from Chrome', d)
d = parseUserAgent(iphone)
check(d?.type === 'phone' && d.os === 'iOS 17.5' && d.browser === 'Safari 17', 'iPhone Safari', d)
d = parseUserAgent(ipad)
check(d?.type === 'tablet' && d.os === 'iOS 16.6', 'iPad is a tablet', d)
d = parseUserAgent(windows)
check(d?.type === 'computer' && d.os === 'Windows 10/11' && d.browser === 'Edge 128', 'Edge on Windows, not Chrome', d)
d = parseUserAgent(mac)
check(d?.type === 'computer' && d.os === 'macOS 10.15.7' && d.browser === 'Firefox 130', 'Firefox on a Mac', d)
check(parseUserAgent(null) === null, 'no browser string, no device')

const now = Date.parse('2026-10-08T10:00:00Z')
let loc = readBrowserLocation(`6.6018,3.3515,12,${now - 60_000}`, now)
check(loc?.lat === 6.6018 && loc.accuracy_m === 12, 'a fresh browser reading is used', loc)
check(readBrowserLocation(`6.6,3.35,12,${now - 3 * 3_600_000}`, now) === null, 'a reading three hours old is not')
check(readBrowserLocation(`6.6,3.35,12,${now + 3_600_000}`, now) === null, 'a reading from the future is not')
check(readBrowserLocation('6.6,3.35,9000,' + now, now) === null, 'a reading 9 km wide is not')
check(readBrowserLocation('95,3.35,10,' + now, now) === null, 'an impossible latitude is not')
check(readBrowserLocation('hello', now) === null, 'garbage is not')
loc = readBrowserLocation(undefined, now)
check(loc === null, 'no cookie, no reading')

check(actionLabel('user.create') === 'Added a staff member', 'labels a known action')
check(actionLabel('export.visits.xlsx') === 'Exported visits (Excel)', 'labels an export', actionLabel('export.visits.xlsx'))
check(actionLabel('export.pdf') === 'Exported attendance (PDF)', 'labels an attendance export', actionLabel('export.pdf'))
check(actionLabel('xm.sale.void') === 'Voided a sale', 'labels a void', actionLabel('xm.sale.void'))

const entry = (id: string, at: string, device: AuditEntry['device'], lat: number | null, src: 'browser' | 'ip' | null = 'browser'): AuditEntry => ({
  id, actor_id: 'boss', actor_name: 'Boss', actor_role: 'admin', action: 'user.update', target_table: null, target_id: null,
  meta: {}, created_at: at, ip: null, user_agent: null, device, lat, lng: lat == null ? null : 3.35,
  accuracy_m: 10, location_source: lat == null ? null : src, place: null, country: null, vpn: false,
})
const laptop = { type: 'computer' as const, os: 'Windows 10/11', browser: 'Chrome 128', app: false }
const laptopNewer = { ...laptop, browser: 'Chrome 129' }
const phone = { type: 'phone' as const, os: 'Android 14', browser: 'Chrome 128', app: false }
// Newest first, as fetched.
const history = [
  entry('e5', '2026-10-08T12:00:00Z', laptop, 9.06, 'ip'), // Abuja, but only from the IP
  entry('e4', '2026-10-08T11:00:00Z', phone, 9.06), // Abuja by GPS, on a phone
  entry('e3', '2026-10-08T10:00:00Z', laptopNewer, 6.61), // Chrome updated: same device
  entry('e2', '2026-10-08T09:00:00Z', laptop, 6.6),
  entry('e1', '2026-10-08T08:00:00Z', laptop, 6.6),
]
const marks = markNew(history)
check(!marks.get('e1')!.newDevice && !marks.get('e1')!.newPlace, 'the first action is never flagged')
check(!marks.get('e3')!.newDevice, 'a browser update is not a new device')
check(!marks.get('e3')!.newPlace, 'a kilometre away is not a new location')
check(marks.get('e4')!.newDevice && marks.get('e4')!.newPlace, 'a phone in Abuja is a new device and a new location', marks.get('e4'))
check(!marks.get('e5')!.newPlace, 'an IP location is too rough to call new')

const f = parseAuditFilter({ person: 'x; drop table', from: '2026-10-01', to: 'yesterday', group: 'Exports', flagged: '1' })
check(f.person === null && f.from === '2026-10-01' && f.to === null && f.group === 'Exports' && f.flagged, 'the filter keeps only what is well formed', f)

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL AUDIT CHECKS PASSED')
