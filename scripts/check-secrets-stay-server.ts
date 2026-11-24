/**
 * Checks that no secret key can reach a browser (developer tools, page
 * source, downloaded scripts). Next.js only puts settings whose names start
 * with NEXT_PUBLIC_ into the browser; everything else stays on the server.
 * So: no secret may have a NEXT_PUBLIC_ name, no browser ('use client')
 * file may read a secret setting or import the server-only clients, the
 * service-role client stays server-only, browsers get no source maps, and
 * no key is written into the repository. It never prints a value.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-secrets-stay-server.ts
 *
 * For the full proof, scripts/check-browser-bundle-secrets.sh builds with
 * fake marked keys and searches what a browser downloads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

let failed = 0
function check(ok: boolean, label: string, detail?: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${detail ? ` (${detail})` : ''}`)
  }
}
const root = path.join(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
const files = walk('src')
const SECRETISH = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|_KEY_P8|SERVICE_ACCOUNT|REDIS_URL|APNS_KEY$)/

// 1. A NEXT_PUBLIC_ name goes to every browser: never a secret.
const publicNames = new Set<string>()
for (const f of files) for (const m of read(f).matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) publicNames.add(m[1])
for (const m of read('.env.example').matchAll(/^(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)) publicNames.add(m[1])
const badPublic = [...publicNames].filter((n) => SECRETISH.test(n))
check(badPublic.length === 0, 'no secret has a NEXT_PUBLIC_ (browser) name', badPublic.join(', '))

// 2. Browser files read no secret settings and import no server-only client.
const SERVER_ONLY_MODULES = ['@/lib/supabase/admin', '@/lib/system-reset-server', '@/lib/geocode', '@/lib/push', '@/lib/push-native', '@/lib/redis', '@/lib/cron', '@/lib/credentials', '@/lib/assistant', '@/lib/reconfirm']
const leaks: string[] = []
for (const f of files) {
  const src = read(f)
  if (!/^['"]use client['"]/m.test(src)) continue
  for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (!m[1].startsWith('NEXT_PUBLIC_') && m[1] !== 'NODE_ENV') leaks.push(`${f} reads ${m[1]}`)
  }
  for (const mod of SERVER_ONLY_MODULES) if (src.includes(`'${mod}'`)) leaks.push(`${f} imports ${mod}`)
}
check(leaks.length === 0, 'browser files read no secret settings and import no server-only code', leaks.join('; '))

// 3. The service-role (secret key) client cannot be bundled for a browser.
check(/^import 'server-only'/m.test(read('src/lib/supabase/admin.ts')), 'the secret-key Supabase client is server-only')
const serviceUsers = files.filter((f) => read(f).includes('process.env.SUPABASE_SERVICE_ROLE_KEY'))
check(serviceUsers.every((f) => /import 'server-only'/.test(read(f)) || /\/route\.ts$/.test(f)),
  'only server files read the Supabase secret key', serviceUsers.join(', '))
const health = read('src/app/api/health/route.ts')
check(!/process\.env\.(SUPABASE_SERVICE_ROLE_KEY|GOOGLE_MAPS_API_KEY|CRON_SECRET|REDIS_URL)(?!\))/.test(health.replace(/Boolean\(process\.env\.[A-Z_]+\)/g, '')),
  'the health page only says whether keys are set, never their values')

// 4. No source maps for browsers (they would show the server code's shape).
check(!/productionBrowserSourceMaps:\s*true/.test(read('next.config.ts')), 'browsers get no source maps')

// 5. Nothing secret is in the repository.
const gi = read('.gitignore')
check(/^\.env$/m.test(gi) && /^\.env\.\*$/m.test(gi), '.env files are never committed')
let tracked = ''
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
} catch {
  tracked = ''
}
const envTracked = tracked.split('\n').filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith('.env.example'))
check(envTracked.length === 0, 'no .env file is tracked', envTracked.join(', '))
let keyFiles = 0
try {
  const out = execFileSync('git', ['grep', '-lE', 'sb_secret_[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY', '--', '.', ':!node_modules'], { cwd: root, encoding: 'utf8' })
  keyFiles = out.trim() ? out.trim().split('\n').length : 0
} catch {
  keyFiles = 0 // git grep exits 1 when nothing matches
}
check(keyFiles === 0, 'no secret key is written into any tracked file', `${keyFiles} file(s)`)

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL SECRETS-STAY-SERVER CHECKS PASSED')
