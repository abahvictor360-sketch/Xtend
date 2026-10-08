/**
 * Checks the store visit and alert reviews (src/lib/visit-review.ts,
 * src/lib/alert-review.ts): filters, figures, what is worth a look, store
 * coverage, alert ages and repeat offenders.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-visits-alerts.ts
 */
import {
  coverage,
  coverageCounts,
  hops,
  notVisitedIn,
  parseVisitFilter,
  personBreakdown,
  storeBreakdown,
  visitFigures,
  visitQueryString,
  worthALook,
  type CoverageRow,
  type VisitRow,
} from '@/lib/visit-review'
import {
  ageText,
  alertLinks,
  alertQueryString,
  byPerson,
  parseAlertFilter,
  repeatOffenders,
  typeCounts,
  typeMix,
} from '@/lib/alert-review'
import type { AlertDetail, AlertType } from '@/lib/types'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const T = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h - 1, m)).toISOString() // Lagos h:m
const ADA = '11111111-1111-1111-1111-111111111111'
const BALA = '22222222-2222-2222-2222-222222222222'
const MALL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const mall = { lat: 6.6018, lng: 3.3515 }
const lekki = { lat: 6.4474, lng: 3.472 }

let n = 0
function visit(over: Partial<VisitRow> & { arrived_at: string }): VisitRow {
  const minutes = over.departed_at ? Math.round((Date.parse(over.departed_at) - Date.parse(over.arrived_at)) / 60000) : 30
  return {
    id: `v${++n}`,
    user_id: ADA,
    staff_name: 'Ada Okafor',
    outlet_id: MALL,
    outlet_name: 'Ikeja City Mall',
    outlet_address: null,
    visit_date: over.arrived_at.slice(0, 10),
    status: over.departed_at ? 'closed' : 'open',
    departed_at: null,
    minutes,
    arrived_status: 'on_site',
    departed_status: over.departed_at ? 'on_site' : null,
    arrived_distance_m: 20,
    departed_distance_m: 20,
    arrived_lat: mall.lat,
    arrived_lng: mall.lng,
    arrived_label: 'Ikeja City Mall',
    store_label: 'Ikeja City Mall',
    store_label_source: 'outlet',
    selfie_path: null,
    ...over,
  }
}

// --- Filters -------------------------------------------------------------
const f = parseVisitFilter(new URLSearchParams('from=2026-10-01&to=2026-10-08&user_id=nope&outlet_id=' + MALL + '&status=none&short=10&view=coverage&gap=14&team=all'))
check(f.from === '2026-10-01' && f.to === '2026-10-08' && f.user_id === null && f.outlet_id === MALL, 'visit filter keeps good dates and ids, drops bad ones', f)
check(f.status === 'none' && f.short === 10 && f.view === 'coverage' && f.gap === 14 && f.team === null, 'visit filter reads status, length, view and gap', f)
check(parseVisitFilter({ view: 'odd', gap: '9', short: '-3', status: 'bogus' }).view === 'visits', 'an unknown view falls back to the visits')
check(parseVisitFilter(new URLSearchParams(visitQueryString(f))).gap === 14 && visitQueryString({ ...f, view: 'visits', gap: null }).includes('short=10'), 'the query string round-trips')

// --- One day of visits ---------------------------------------------------
// Ada: two hours at the mall, then "checks in" at Lekki 5 minutes after leaving (about 20 km).
const day = [
  visit({ arrived_at: T(8, 8), departed_at: T(8, 10), departed_lat: mall.lat, departed_lng: mall.lng }),
  visit({ arrived_at: T(8, 10, 5), departed_at: T(8, 10, 9), outlet_id: null, outlet_name: null, arrived_status: null, arrived_distance_m: null,
    arrived_lat: lekki.lat, arrived_lng: lekki.lng, store_label: 'Shoprite Lekki', store_label_source: 'map' }),
  // Bala: arrives 900 m away from the mall, then an honest 40-minute trip of 2 km.
  visit({ user_id: BALA, staff_name: 'Bala Yusuf', arrived_at: T(8, 9), departed_at: T(8, 9, 50), arrived_status: 'off_site', arrived_distance_m: 900,
    arrived_lat: 6.6099, arrived_lng: 3.3515, departed_lat: 6.6099, departed_lng: 3.3515 }),
  visit({ user_id: BALA, staff_name: 'Bala Yusuf', arrived_at: T(8, 10, 30), departed_at: T(8, 11, 30), arrived_lat: 6.6279, arrived_lng: 3.3515,
    outlet_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', outlet_name: 'Ogba Store', store_label: 'Ogba Store' }),
  // Still open: never "short", however young.
  visit({ user_id: BALA, staff_name: 'Bala Yusuf', arrived_at: T(8, 12), minutes: 2 }),
]

const fig = visitFigures(day)
check(fig.visits === 5 && fig.people === 2 && fig.stores === 3 && fig.open === 1, 'figures: visits, people, stores (a map-named shop counts once), open', fig)
check(fig.short === 1 && fig.offSite === 1, 'figures: one short visit, one arrival away from the store', fig)
check(fig.averageMinutes === Math.round((120 + 4 + 50 + 60) / 4), 'figures: the average is over finished visits only', fig)

const hopList = hops(day)
check(hopList.length === 1 && hopList[0].to.store_label === 'Shoprite Lekki' && hopList[0].kmh > 200, 'hops: 20 km in 5 minutes is not a real trip', hopList.map((h) => [h.distanceM, h.kmh]))
check(!hopList.some((h) => h.from.user_id === BALA), 'hops: 2 km in 40 minutes is fine')

const look = worthALook(day)
const kinds = look.map((l) => `${l.name}:${l.kind}`).sort()
check(JSON.stringify(kinds) === JSON.stringify(['Ada Okafor:hop', 'Ada Okafor:short', 'Bala Yusuf:far']), 'worth a look: the hop, the 4-minute visit and the far check-in', kinds)
check(look.find((l) => l.kind === 'far')!.text.includes('900 m'), 'worth a look: the far check-in says how far', look)
check(worthALook(day, 3).every((l) => l.kind !== 'short'), 'worth a look: the short threshold is respected')

const stores = storeBreakdown(day)
check(stores[0].name === 'Ikeja City Mall' && stores[0].visits === 3 && stores[0].other === 2 && stores[0].offSite === 1, 'by store: the mall had three visits from two people', stores[0])
check(stores.some((s) => s.name === 'Shoprite Lekki' && s.id === null), 'by store: a shop not on Xtend is listed by its map name')
const people = personBreakdown(day)
check(people[0].name === 'Bala Yusuf' && people[0].visits === 3 && people[0].other === 2, 'by person: Bala first with three visits to two stores', people[0])

// --- Coverage ------------------------------------------------------------
const cov = (name: string, last: string | null, staff: number): CoverageRow => ({
  outlet_id: name, name, address: null, lat: 6.6, lng: 3.35, is_active: true, staff_assigned: staff,
  last_visit_at: last ? `${last}T09:00:00Z` : null, last_visit_date: last, last_visit_user_id: null,
  last_visit_by: last ? 'Ada Okafor' : null, visits_30d: last ? 1 : 0,
})
const rows = [cov('Fresh', '2026-10-08', 1), cov('Week', '2026-10-01', 1), cov('Month', '2026-09-01', 2), cov('Never', null, 1), cov('Not ours', null, 0),
  { ...cov('Closed', null, 1), is_active: false }]
const all = coverage(rows, '2026-10-08', true)
check(all.map((r) => r.name).join(',') === 'Never,Not ours,Month,Week,Fresh', 'coverage: never visited first, then longest without a visit; closed stores left out', all.map((r) => r.name))
check(all.find((r) => r.name === 'Week')!.daysSince === 7 && all.find((r) => r.name === 'Fresh')!.daysSince === 0, 'coverage: days since the last visit')
const mine = coverage(rows, '2026-10-08', false)
check(!mine.some((r) => r.name === 'Not ours'), 'coverage: a supervisor does not see stores nobody of theirs covers or visited')
const counts = coverageCounts(all)
check(counts.over7 === 4 && counts.over14 === 3 && counts.over30 === 3 && counts.never === 2, 'coverage: counts not visited in 7, 14 and 30 days', counts)
check(notVisitedIn(all, 30).every((r) => r.daysSince === null || r.daysSince >= 30), 'coverage: the 30-day list')

// --- Alerts --------------------------------------------------------------
const af = parseAlertFilter({ show: 'resolved', type: 'left_geofence', person: ADA, from: '2026-10-08', to: '2026-10-01' })
check(af.state === 'resolved' && af.type === 'left_geofence' && af.person === ADA && af.to === '2026-10-08', 'alert filter: old resolved link, type, person, and a backwards range fixed', af)
check(parseAlertFilter({ state: 'all', type: 'nonsense' }).state === 'all' && parseAlertFilter({}).state === 'open' && parseAlertFilter({ type: 'nonsense' }).type === null, 'alert filter: open by default, all on request, unknown kinds dropped')
check(alertQueryString(parseAlertFilter({})) === '', 'alert filter: the default needs no query string')

const NOW = Date.parse(T(8, 15))
let k = 0
const alert = (user: string, name: string, type: AlertType, at: string, resolvedAt: string | null = null): AlertDetail => ({
  id: `a${++k}`, user_id: user, staff_name: name, staff_phone: null, outlet_name: 'Ikeja City Mall', place_name: null, address: null,
  lat: null, lng: null, location_label: null, alert_type: type, distance_m: 400, is_resolved: Boolean(resolvedAt), note: null,
  created_at: at, resolved_at: resolvedAt, resolved_by_name: resolvedAt ? 'Ngozi Eze' : null, attendance_id: null,
})
const alerts = [
  alert(ADA, 'Ada Okafor', 'left_geofence', T(8, 12)),
  alert(ADA, 'Ada Okafor', 'left_geofence', T(7, 11), T(7, 11, 25)),
  alert(ADA, 'Ada Okafor', 'off_site_clock', T(6, 8)),
  alert(BALA, 'Bala Yusuf', 'low_accuracy', T(8, 14, 50)),
]
check(ageText(alerts[0], NOW) === 'open for 3 h', 'age: open for 3 h', ageText(alerts[0], NOW))
check(ageText(alerts[1], NOW) === 'resolved after 25 min', 'age: resolved after 25 min', ageText(alerts[1], NOW))
check(ageText(alerts[2], NOW) === 'open for 2 days', 'age: open for 2 days', ageText(alerts[2], NOW))
check(ageText(alerts[3], NOW) === 'open for 10 min', 'age: open for 10 min', ageText(alerts[3], NOW))
const tc = typeCounts(alerts)
check(tc.left_geofence === 2 && tc.off_site_clock === 1 && tc.low_accuracy === 1 && tc.permission_denied === 0, 'counts by kind', tc)
const grouped = byPerson(alerts)
check(grouped[0].name === 'Ada Okafor' && grouped[0].total === 3 && grouped[0].open === 2 && grouped[0].days === 3 && grouped[0].oldestOpen === T(6, 8), 'by person: Ada first, three alerts on three days, two open', grouped[0])
check(repeatOffenders(grouped).map((p) => p.name).join() === 'Ada Okafor', 'repeat offenders: three or more alerts')
check(typeMix(grouped[0].types) === '2 left the store, 1 away from the store', 'the mix of kinds, biggest first', typeMix(grouped[0].types))
const links = alertLinks(alerts[2])
check(links.movement === `/admin/tracking?person=${ADA}&date=2026-10-06&until=2026-10-06`, 'links: Movement for that person and day', links.movement)
check(links.excuse.includes('date=2026-10-06') && links.excuse.includes('from=07%3A00') && links.excuse.includes('to=09%3A00'), 'links: an excuse window an hour either side', links.excuse)

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL VISIT AND ALERT CHECKS PASSED')
