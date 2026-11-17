/**
 * The dashboard's side menu (src/components/admin/admin-nav.tsx) and the
 * shared table (src/components/ui/table.tsx).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-admin-nav.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchesQuery } from '@/components/admin/admin-nav'

let failed = 0
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

check(matchesQuery('Store visits', 'Attendance', '') && matchesQuery('Store visits', 'Attendance', '   '), 'an empty search shows every page')
check(matchesQuery('Store visits', 'Attendance', 'visit') && matchesQuery('Store visits', 'Attendance', 'STORE'), 'by name, ignoring case')
check(matchesQuery('X Metrics', 'Stock', 'stock'), 'by group: "stock" finds X Metrics')
check(matchesQuery('Check an excuse', 'Checks', 'excuse check'), 'every word, in any order')
check(!matchesQuery('Outlets', 'Setup', 'leave'), 'other pages are hidden')

const nav = read('src/components/admin/admin-nav.tsx')
check(/localStorage\.setItem\(OPEN_KEY/.test(nav) && /holdsCurrent/.test(nav), 'groups fold away; the current one opens; what is opened is remembered')
check(/<Count n=\{badges\[link\.href\]\}/.test(nav), 'counts show beside their links')
const layout = read('src/app/admin/layout.tsx')
check(/'\/admin\/alerts': location \?\? null, '\/admin\/integrity': flags \?\? null/.test(layout) && /hr \? \{\}/.test(layout),
  'open alerts beside Alerts and flags to review beside Integrity; none for HR')
const frame = read('src/components/admin/admin-frame.tsx')
check(/href="\/mfa\/setup"/.test(frame) && /href="\/admin\/sign-in-methods"/.test(frame) && /href="\/change-password"/.test(frame) && /<SignOutButton/.test(frame),
  'the account card keeps two-step sign-in, fingerprint and passkeys, password and sign out')

// The table keeps its own padding and alignment and adds the caller's classes.
const table = read('src/components/ui/table.tsx')
for (const tag of ['thead', 'tbody', 'tr', 'th', 'td']) {
  check(new RegExp(`<${tag}\\s+\\{\\.\\.\\.p\\}\\s+className=\\{cn\\(`).test(table), `<${tag}>: props first, classes merged after`)
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL ADMIN NAV CHECKS PASSED')
