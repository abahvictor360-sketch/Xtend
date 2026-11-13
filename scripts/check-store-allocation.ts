/**
 * Store allocation shop search (src/lib/outlet-search.ts) and the stock
 * count switches admins see on Roles and on Store counts
 * (src/components/admin/store-count-switches.tsx, migration 046).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-store-allocation.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { searchOutlets } from '@/lib/outlet-search'
import { countNotice } from '@/components/admin/store-count-switches'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const shops = [
  { id: '1', name: 'Justrite Superstore Bariga', address: '56 Jagun Molu St, Bariga, Lagos' },
  { id: '2', name: 'Shoprite Surulere', address: 'Adeniran Ogunsanya St, Surulere, Lagos' },
  { id: '3', name: 'Shoprite Ikeja City Mall', address: 'Obafemi Awolowo Way, Ikeja' },
  { id: '4', name: 'Café Délice Wuse', address: null },
  { id: '5', name: 'Spar Lekki', address: 'Admiralty Way, Lekki Phase 1' },
]
const ids = (q: string) => searchOutlets(shops, q).map((s) => s.id)

check(ids('').length === 5 && ids('   ').length === 5, 'an empty search shows every shop')
check(JSON.stringify(ids('shoprite')) === '["2","3"]', 'by name, ignoring case', ids('shoprite'))
check(JSON.stringify(ids('surulere')) === '["2"]', 'by area in the name or address', ids('surulere'))
check(JSON.stringify(ids('ikeja shoprite')) === '["3"]', 'every word must match, in any order', ids('ikeja shoprite'))
check(JSON.stringify(ids('Awolowo')) === '["3"]', 'by street in the address', ids('Awolowo'))
check(JSON.stringify(ids('cafe delice')) === '["4"]', 'accents do not matter', ids('cafe delice'))
check(JSON.stringify(ids('lekki,')) === '["5"]', 'commas are ignored', ids('lekki,'))
check(ids('ibadan').length === 0, 'no match gives no shops')
{
  const stockists = read('data/stockists-july.csv').split('\n').slice(1).filter(Boolean)
    .map((line, i) => ({ id: String(i), name: (line.match(/^"([^"]+)"|^([^,]+)/)?.[1] ?? line.split(',')[0]).trim(), address: null }))
  const pick = stockists[Math.floor(stockists.length / 2)]
  const found = searchOutlets(stockists, pick.name.toUpperCase())
  check(stockists.length > 50 && found.some((s) => s.id === pick.id),
    `the real stockist list: "${pick.name}" is found among ${stockists.length} shops`)
}

const allocator = read('src/components/admin/outlet-allocator.tsx')
check(/searchOutlets\(outlets, shopSearch\)/.test(allocator) && /\{shops\.map\(\(outlet\) =>/.test(allocator)
    && /placeholder="Search shops by name or address"/.test(allocator),
  'the allocation editor lists only the shops that match the search')
check(/setChosen\(new Set\(person\.outlet_ids\)\)\s*\n\s*setShopSearch\(''\)/.test(allocator),
  'opening someone’s stores starts with an empty search')
check(/body: JSON\.stringify\(\{ user_id: person\.user_id, outlet_ids: \[\.\.\.chosen\] \}\)/.test(allocator),
  'saving sends every chosen shop, also those the search hides')

// The stock count switches.
const switches = read('src/components/admin/store-count-switches.tsx')
check(/'\/api\/admin\/role-store-counts'/.test(switches) && /`\/api\/admin\/staff-roles\/\$\{r\.id\}`/.test(switches),
  'built-in Merchandisers and Marketers, and added roles, each have their switch')
check(/StoreCountSwitches builtInCounts=\{builtInCounts\} roles=\{roles\}/.test(read('src/components/admin/role-manager.tsx')),
  'the Roles page shows the switches')
const counts = read('src/app/admin/store-counts/page.tsx')
check(/\{isAdmin && \(\s*<StoreCountSwitches/.test(counts), 'the Store counts page shows them to admins only')
check(/requireApiSession\(\['admin'\]\)/.test(read('src/app/api/admin/role-store-counts/route.ts')),
  'only an admin may switch a built-in role')
check(countNotice('Marketers', false).startsWith('Marketers no longer take stock counts')
    && /Count tab/.test(countNotice('Marketers', false)) && countNotice('Marketers', true).startsWith('Marketers now take'),
  'the admin is told what switching does')

// What the app does with the switch (migration 046, already in place).
const layout = read('src/app/field/layout.tsx')
check(/canCountStock=\{countStatus\.open\}/.test(layout), 'off: no Count tab')
check(/countStatus\.open && <CountDueBanner/.test(read('src/app/field/page.tsx')), 'off: no count-due banner')
check(/countStatus\.reason !== 'not_allowed'/.test(read('src/app/field/account/page.tsx')), 'off: no count sheet on the profile')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL STORE ALLOCATION CHECKS PASSED')
