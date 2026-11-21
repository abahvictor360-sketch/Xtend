/**
 * Checks reading a store's position from what an admin pastes into the
 * outlet form (src/lib/map-link.ts): Google Maps links of every shape,
 * OpenStreetMap links, plain coordinates, and shared short links that the
 * server must open first.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-map-link.ts
 */
import { readMapLink, mapsLink } from '@/lib/map-link'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}

function at(text: string, lat: number, lng: number, label: string) {
  const r = readMapLink(text)
  check(r.point?.lat === lat && r.point?.lng === lng && !r.short, label, r)
}

at('6.601900, 3.351600', 6.6019, 3.3516, 'plain coordinates as Google Maps copies them')
at('(6.4474, 3.4720)', 6.4474, 3.472, 'coordinates in brackets')
at('6.4474 3.4720', 6.4474, 3.472, 'coordinates with only a space')
at(
  'https://www.google.com/maps/place/Ikeja+City+Mall/@6.6142,3.3570,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d6.6137594!4d3.3580512!16s',
  6.613759, 3.358051,
  'a place link: the pin (!3d!4d) wins over the map centre',
)
at('https://www.google.com/maps/@6.5244,3.3792,15z', 6.5244, 3.3792, 'a map link: the centre')
at('https://maps.google.com/?q=6.5965,3.3421', 6.5965, 3.3421, '?q=lat,lng')
at('https://www.google.com/maps/search/?api=1&query=6.45,3.39', 6.45, 3.39, '?query=lat,lng')
at('https://www.google.com/maps/search/6.4281,+3.4219?entry=tts', 6.4281, 3.4219, '/maps/search/lat,+lng')
at('https://www.google.com/maps?ll=6.60,3.35&z=16', 6.6, 3.35, '?ll=')
at('https://www.google.com/maps/dir/?api=1&destination=6.61,3.36', 6.61, 3.36, 'directions destination')
at('https://www.openstreetmap.org/#map=17/6.60190/3.35160', 6.6019, 3.3516, 'an OpenStreetMap link')
at('https://www.openstreetmap.org/?mlat=6.6&mlon=3.35#map=17/6.6/3.35', 6.6, 3.35, 'an OpenStreetMap marker')
at('Look here https://maps.google.com/?q=6.5,3.3 thanks', 6.5, 3.3, 'a link inside a sentence')

const short = readMapLink('https://maps.app.goo.gl/AbCdEf123')
check(short.short && !short.point, 'a shared short link is opened by the server', short)
check(readMapLink('https://goo.gl/maps/xyz').short, 'an old goo.gl/maps link too')

const named = readMapLink('https://www.google.com/maps/place/Justrite+Superstore+Ogba/')
check(!named.point && named.query === 'Justrite Superstore Ogba', 'a place link with no position gives its name to search', named)

check(!readMapLink('https://evil.example.com/?q=6.5,3.3').point, 'links from other sites are ignored')
check(!readMapLink('0, 0').point, '0,0 is not a store')
check(!readMapLink('95, 3').point, 'impossible coordinates are refused')
check(!readMapLink('Justrite Ogba').point, 'plain words are not coordinates')
check(mapsLink(6.6, 3.35) === 'https://www.google.com/maps/search/?api=1&query=6.6,3.35', 'the check-on-Google-Maps link')

{
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  const geo = read('src/lib/geocode.ts')
  check(/redirect: 'manual'/.test(geo) && /MAP_HOSTS\.test\(current\.hostname\)/.test(geo),
    'a short link is opened one redirect at a time, map hosts only')
  const route = read('src/app/api/admin/outlets/locate/route.ts')
  check(/requireApiSession\(\['admin'\]\)/.test(route) && /allowAttempt\(/.test(route),
    'only admins search, within the hourly limit')
  const form = read('src/components/admin/outlet-manager.tsx')
  check(/Find on map/.test(form) && /Or paste a Google Maps link/.test(form) && /Check on Google Maps/.test(form),
    'the outlet form finds the address, takes a link, and offers a check')
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL MAP LINK CHECKS PASSED')
