/**
 * Checks that Google is used as little as possible (src/lib/place-resolve.ts,
 * migration 0068) and how the office maps choose their base map
 * (src/lib/base-map.ts): a spot Xtend already knows never reaches Google,
 * what Google finds is kept, the monthly limit switches to OpenStreetMap,
 * and the maps fall back to OpenStreetMap whenever Google does not work.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-places-usage.ts
 */
import { readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import {
  lookupSummary,
  metresBetween,
  parseLimit,
  resolveWith,
  withinLimit,
  type GoogleAnswer,
  type LookupCount,
  type PlaceProviders,
  type ResolvedPlace,
} from '@/lib/place-resolve'
import {
  GOOGLE_GRACE_MS,
  OSM_ERROR_LIMIT,
  baseMapLabel,
  chooseBaseMap,
  type BaseMapState,
} from '@/lib/base-map'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const read = (p: string) => readFileSync(joinPath(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n')

/**
 * A small Xtend in memory: stores, learned places (50 m), saved addresses
 * (40 m), a Google that answers from `googleWorld`, and the monthly counter.
 */
function world(opts: { limit?: number | null; googleKey?: boolean } = {}) {
  const stores = [{ name: 'Ikeja City Mall', address: 'Obafemi Awolowo Way, Ikeja', lat: 6.6018, lng: 3.3515, r: 150 }]
  const known: { id: string; name: string; address: string | null; lat: number; lng: number }[] = []
  const addresses: { address: string; lat: number; lng: number }[] = []
  const counted: LookupCount[] = []
  const visits: string[] = []
  const calls = { google: 0, osm: 0 }
  // What Google knows: a shop at Bariga, only a street at Yaba.
  const googleWorld = [
    { lat: 6.5395, lng: 3.3870, name: 'Justrite Superstore Bariga', address: '56 Jagun Molu St, Bariga, Lagos' },
    { lat: 6.5100, lng: 3.3780, name: null, address: '12 Herbert Macaulay Way, Yaba, Lagos' },
  ]
  let cacheNext = false
  const near = (a: { lat: number; lng: number }, lat: number, lng: number, r: number) =>
    metresBetween(a.lat, a.lng, lat, lng) <= r
  const googleUsed = () => counted.filter((c) => c.startsWith('call_')).length

  const p: PlaceProviders = {
    store: async (lat, lng) => {
      const s = stores.find((x) => near(x, lat, lng, x.r))
      return s ? { name: s.name, address: s.address, label: s.name, source: 'outlet' } : null
    },
    known: async (lat, lng) => {
      const k = known.find((x) => near(x, lat, lng, 50))
      return k ? { id: k.id, place: { name: k.name, address: k.address, label: k.name, source: 'known' } } : null
    },
    noteVisit: async (id) => {
      visits.push(id)
    },
    savedAddress: async (lat, lng) => addresses.find((a) => near(a, lat, lng, 40))?.address ?? null,
    googleAllowed: async () => (opts.googleKey ?? true) && withinLimit(googleUsed(), opts.limit ?? null),
    google: async (lat, lng): Promise<GoogleAnswer> => {
      if (cacheNext) {
        cacheNext = false
        return { place: { name: 'Cached Shop', address: null, label: 'Cached Shop', source: 'google' }, fresh: false, calls: [] }
      }
      calls.google++
      const g = googleWorld.find((x) => near(x, lat, lng, 80))
      if (!g) return { place: null, fresh: true, calls: ['call_nearby', 'call_geocode'] }
      return {
        place: { name: g.name, address: g.address, label: g.name ?? g.address, source: 'google' },
        fresh: true,
        calls: g.name ? ['call_nearby'] : ['call_nearby', 'call_geocode'],
      }
    },
    osm: async (lat, lng) => {
      calls.osm++
      if (lat > 9) return null // nothing known up north, for the test
      return { name: null, address: 'Some Road, Lagos', label: 'Some Road, Lagos', source: 'osm' }
    },
    learnPlace: async (lat, lng, place) => {
      if (!place.name || stores.some((s) => near(s, lat, lng, s.r)) || known.some((k) => near(k, lat, lng, 50))) return
      known.push({ id: `k${known.length + 1}`, name: place.name, address: place.address, lat, lng })
    },
    rememberAddress: async (lat, lng, address) => {
      if (!addresses.some((a) => near(a, lat, lng, 40))) addresses.push({ address, lat, lng })
    },
    count: (what) => {
      counted.push(...what)
    },
  }
  return {
    p,
    known,
    addresses,
    counted,
    visits,
    calls,
    useCache: () => {
      cacheNext = true
    },
  }
}

async function main() {
  // --- The order: a store, a learned place, a saved address, then Google.
  {
    const w = world()
    const own = { name: 'My Store', address: '1 Allen Ave', lat: 6.6, lng: 3.35, radius_m: 100 }
    const a = await resolveWith(w.p, 6.6001, 3.3501, own, { learn: true })
    check(a.source === 'outlet' && a.name === 'My Store' && w.calls.google === 0 && same(w.counted, ['store']),
      'standing in their own store: the store names it, no map asked', { a, counted: w.counted })

    const b = await resolveWith(w.p, 6.6019, 3.3516, null, { learn: true })
    check(b.name === 'Ikeja City Mall' && w.calls.google === 0 && w.calls.osm === 0,
      'inside any store Xtend knows: no map asked', b)

    // Bariga: new to Xtend, so Google once, and the shop is learned.
    const c1 = await resolveWith(w.p, 6.5395, 3.3870, null, { learn: true })
    check(c1.name === 'Justrite Superstore Bariga' && w.calls.google === 1 && w.known.length === 1,
      'a spot Xtend has never seen goes to Google once, and the shop is learned', { c1, known: w.known })
    const c2 = await resolveWith(w.p, 6.53965, 3.38712, null, { learn: true })
    check(c2.source === 'known' && c2.name === 'Justrite Superstore Bariga' && w.calls.google === 1,
      'the next clock-in 20 m away is named from the saved place: Google is not asked again', c2)
    check(same(w.visits, ['k1']), 'and the visit is counted at the learned place', w.visits)
    for (let i = 0; i < 5; i++) await resolveWith(w.p, 6.5395 + i * 0.00005, 3.387, null, { learn: true })
    check(w.calls.google === 1, 'five more lookups there: still one Google request in all', w.calls)

    // Yaba: Google knows only the street. The address is kept on its own.
    const d1 = await resolveWith(w.p, 6.51, 3.378, null, { learn: true })
    check(d1.name === null && d1.address === '12 Herbert Macaulay Way, Yaba, Lagos' && w.addresses.length === 1
      && w.known.length === 1,
      'an address with no shop is saved as an address, not as a named place', { d1, addresses: w.addresses })
    const googleBefore = w.calls.google
    const d2 = await resolveWith(w.p, 6.5101, 3.3781, null, { learn: true })
    check(d2.label === '12 Herbert Macaulay Way, Yaba, Lagos' && w.calls.google === googleBefore,
      'the same spot again is answered from the saved address: Google is not asked again', d2)

    const s = lookupSummary(
      Object.entries(
        w.counted.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}),
      ).map(([source, lookups]) => ({ source, lookups })),
      null,
    )
    check(s.google === 2 && s.own === s.total - 2 && s.calls === 3 && s.osm === 0,
      'the counter: two answers from Google (three paid requests), the rest from Xtend\'s own list', s)
  }

  // --- A saved place never calls Google, preview or not.
  {
    const w = world()
    w.known.push({ id: 'k9', name: 'Mama Put Corner', address: null, lat: 6.45, lng: 3.4 })
    const a = await resolveWith(w.p, 6.4501, 3.4001, null, { learn: false })
    check(a.name === 'Mama Put Corner' && w.calls.google === 0 && w.calls.osm === 0 && w.visits.length === 0,
      'a preview at a learned place asks no map and counts no visit', a)
  }

  // --- The server cache answered.
  {
    const w = world()
    w.useCache()
    const a = await resolveWith(w.p, 7.0, 3.9, null, { learn: true })
    check(a.name === 'Cached Shop' && same(w.counted, ['cache']) && w.calls.google === 0,
      'an answer from the server\'s 30-day cache is counted as Xtend\'s own, with no Google request', w.counted)
    check(w.known.length === 1, 'and the cached shop is learned for good', w.known)
  }

  // --- Previews go to OpenStreetMap; nothing is learned.
  {
    const w = world()
    const a = await resolveWith(w.p, 6.5395, 3.3870, null, { google: false, learn: false })
    check(a.source === 'osm' && w.calls.google === 0 && w.known.length === 0 && w.addresses.length === 0,
      'the home screen preview uses OpenStreetMap and learns nothing', a)
  }

  // --- The monthly limit.
  check(parseLimit(undefined) === null && parseLimit('') === null && parseLimit('abc') === null
    && parseLimit('0') === null && parseLimit('-5') === null && parseLimit('2.5') === null && parseLimit(' 5000 ') === 5000,
    'GOOGLE_MONTHLY_LOOKUP_LIMIT: a whole number above zero, anything else is no limit')
  check(withinLimit(0, null) && withinLimit(10, null) && withinLimit(4, 5) && !withinLimit(5, 5) && !withinLimit(9, 5),
    'within the limit below it; at or over it, no more Google')
  check(withinLimit(null, 5), 'a counter that cannot be read leaves Google on')
  {
    const w = world({ limit: 3 })
    await resolveWith(w.p, 6.5395, 3.3870, null, { learn: false }) // 1 request
    await resolveWith(w.p, 6.51, 3.378, null, { learn: false }) // 2 requests: limit reached
    const c = await resolveWith(w.p, 6.40, 3.50, null, { learn: true })
    check(w.calls.google === 2 && c.source === 'osm' && w.counted.includes('osm'),
      'once this month\'s Google requests reach the limit, OpenStreetMap answers instead', { calls: w.calls, c })
  }
  {
    const w = world({ googleKey: false })
    const a = await resolveWith(w.p, 6.5395, 3.3870, null, { learn: true })
    check(a.source === 'osm' && w.calls.google === 0, 'without the server key Google is never asked', a)
  }

  // --- Failures fall through, and nothing found is plain coordinates.
  {
    const w = world()
    const a = await resolveWith(w.p, 6.40, 3.50, null, { learn: true })
    check(a.source === 'osm' && same(w.counted, ['call_nearby', 'call_geocode', 'osm']),
      'Google found nothing: its requests are still counted, and OpenStreetMap answers', w.counted)
    const b = await resolveWith(w.p, 10.5, 7.4, null, { learn: true })
    check(b.source === 'coordinates' && b.label === '10.50000, 7.40000' && w.counted.at(-1) === 'none',
      'nothing anywhere: the coordinates, counted as not named', b)
  }
  {
    const w = world()
    const broken: PlaceProviders = {
      ...w.p,
      store: async () => {
        throw new Error('db down')
      },
      known: async () => {
        throw new Error('db down')
      },
      google: async () => {
        throw new Error('network')
      },
    }
    const a: ResolvedPlace = await resolveWith(broken, 6.5395, 3.3870, null, { learn: true })
    check(a.source === 'osm', 'a broken database or Google never stops a place being named', a)
  }

  // --- The Places card.
  {
    const s = lookupSummary(
      [
        { source: 'store', lookups: 40 },
        { source: 'known', lookups: 30 },
        { source: 'address', lookups: 5 },
        { source: 'cache', lookups: 5 },
        { source: 'google', lookups: 15 },
        { source: 'osm', lookups: 5 },
        { source: 'call_nearby', lookups: 15 },
        { source: 'call_geocode', lookups: 4 },
        { source: 'call_text_search', lookups: 1 },
      ],
      20,
    )
    check(s.own === 80 && s.ownPct === 80 && s.google === 15 && s.googlePct === 15 && s.osm === 5 && s.osmPct === 5,
      'the card: own list 80 (80%), Google 15 (15%), OpenStreetMap 5 (5%)', s)
    check(s.calls === 20 && s.limitReached, 'paid requests 20 of a limit of 20: limit reached', s)
    const empty = lookupSummary([], null)
    check(empty.total === 0 && empty.ownPct === 0 && !empty.limitReached, 'an empty month shows nothing odd', empty)
  }

  // --- The office maps: Google when it works, OpenStreetMap otherwise.
  const st = (s: Partial<BaseMapState>): BaseMapState => ({ hasKey: true, google: 'loading', osmErrors: 0, waitedMs: 0, ...s })
  check(chooseBaseMap(st({ hasKey: false, google: 'off' })) === 'osm', 'no browser key: OpenStreetMap at once')
  check(chooseBaseMap(st({ google: 'ready' })) === 'google', 'key set and Google loaded: Google')
  check(chooseBaseMap(st({ google: 'loading', waitedMs: 200 })) === 'wait',
    'Google still loading: wait a moment rather than load OpenStreetMap for nothing')
  check(chooseBaseMap(st({ google: 'loading', waitedMs: GOOGLE_GRACE_MS + 1 })) === 'osm',
    'Google slow: OpenStreetMap meanwhile, so the map is never blank')
  check(chooseBaseMap(st({ google: 'failed', waitedMs: 7000 })) === 'osm',
    'Google failed (timeout, refused key, no tiles): OpenStreetMap, without a reload')
  check(chooseBaseMap(st({ google: 'ready', osmErrors: OSM_ERROR_LIMIT })) === 'google',
    'OpenStreetMap failing and Google available: Google')
  check(chooseBaseMap(st({ google: 'loading', waitedMs: 3000, osmErrors: OSM_ERROR_LIMIT })) === 'wait',
    'OpenStreetMap failing while Google is still loading: wait for Google')
  check(chooseBaseMap(st({ google: 'failed', osmErrors: OSM_ERROR_LIMIT + 3 })) === 'osm',
    'both failing: keep OpenStreetMap trying (nothing better to show)')
  check(chooseBaseMap(st({ hasKey: false, google: 'off', osmErrors: 10 })) === 'osm',
    'no key and OpenStreetMap failing: still OpenStreetMap, never Google without a key')
  check(same(baseMapLabel('google'), { note: 'Map: Google', satelliteSwitch: true })
    && same(baseMapLabel('osm'), { note: 'Map: OpenStreetMap', satelliteSwitch: false })
    && same(baseMapLabel('wait'), { note: null, satelliteSwitch: false }),
    'the note says which map is in use; Map / Satellite only while Google is shown')

  // --- Wiring.
  const device = read('src/app/api/track/device/route.ts')
  check(/learn: true,\s*\n\s*person: got\.user_id/.test(device),
    'the background tracker learns the spots it names, for the person (0068)')
  const geocode = read('src/lib/geocode.ts')
  check(geocode.includes("rpc('learn_place_for'") && geocode.includes("rpc('note_place_visit_for'")
    && geocode.includes("rpc('address_at'") && geocode.includes("rpc('remember_address'")
    && geocode.includes("rpc('count_place_lookups'") && geocode.includes("rpc('google_calls_this_month')"),
    'geocode.ts uses the 0068 functions')
  check(/locateWithGoogle[\s\S]*?googleAllowed\(\)[\s\S]*?countLookups\(calls\)/.test(geocode),
    'the store importer\'s Google requests are counted and limited too')
  const leaflet = read('src/lib/leaflet.ts')
  check(/googlemutant@\d+\.\d+\.\d+\//.test(leaflet) && /leaflet\/\d+\.\d+\.\d+\//.test(leaflet),
    'GoogleMutant and Leaflet are pinned to exact versions')
  check(leaflet.includes('loading=async') && leaflet.includes('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY')
    && !/process\.env\.GOOGLE_MAPS_API_KEY/.test(leaflet),
    'the map uses the browser key, loaded async, never the server key')
  const base = read('src/components/admin/map-base.tsx')
  check(/\}, \[\]\)\n\n  \/\*\* Map or Satellite/.test(base),
    'the map is made once per page view; refreshes redraw what is on it')
  check(base.includes('setMapTypeId') && !/googleMutant\([^)]*hybrid/.test(base),
    'Satellite switches the same Google map (no second map load)')
  const movement = read('src/components/admin/movement-map.tsx')
  check(!movement.includes('L.map(') && !movement.includes('tileLayer('),
    'Movement maps draw on the shared map and never make their own')
  const sql = read('supabase/migrations/0068_place_lookups.sql')
  for (const fn of ['learn_place_for', 'note_place_visit_for', 'address_at', 'remember_address', 'count_place_lookups', 'google_calls_this_month']) {
    check(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*from public, anon, authenticated;`).test(sql),
      `${fn} is refused to everyone but the server`)
  }

  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nALL PLACE USAGE CHECKS PASSED')
}

void main()
