/**
 * Checks that a crash never shows the browser's bare "Application error: a
 * client-side exception has occurred": the plain-words diagnosis
 * (lib/app-error.ts), the top-level error page, the early reload for a
 * phone holding an old version, and the crash report to the server log.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-app-error.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { diagnoseAppError, errorCode, EARLY_RECOVERY_SCRIPT } from '@/lib/app-error'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const exists = (p: string) => fs.existsSync(path.join(__dirname, '..', p))

check(diagnoseAppError({ message: 'x' }, false).kind === 'offline', 'no connection is said as such')
check(diagnoseAppError({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed.' }, true).kind === 'new_version', 'a missing piece after an update: load the new version')
check(diagnoseAppError({ message: 'Failed to fetch dynamically imported module: /x.js' }, true).primary === 'reload_fresh', 'with the button to load it')
check(diagnoseAppError({ message: 'TypeError: Failed to fetch' }, true).kind === 'offline', 'a dropped connection mid-load')
check(diagnoseAppError({ message: 'boom', digest: '123456789' }, true).kind === 'server', 'a server problem says it is not their fault')
const unknown = diagnoseAppError({ message: 'Cannot read properties of undefined' }, true)
check(unknown.kind === 'unknown' && unknown.primary === 'reload_fresh' && unknown.steps.some((s) => s.includes(unknown.code)), 'anything else: load the new version, and a code for support')
check(errorCode({ message: 'a' }) === errorCode({ message: 'a' }) && errorCode({ message: 'a' }) !== errorCode({ message: 'b' }), 'the same error gives the same code')
for (const k of [diagnoseAppError(null, false), unknown, diagnoseAppError({ message: 'Loading chunk 1 failed' }, true)]) {
  check(k.title.length > 0 && k.message.length > 0 && k.steps.length >= 2 && !/exception|client-side|stack/i.test(JSON.stringify(k)), `${k.kind}: plain words and steps`)
}

check(exists('src/app/global-error.tsx') && /diagnoseAppError/.test(read('src/app/global-error.tsx')), 'a top-level error page replaces the bare browser message')
for (const f of ['src/app/error.tsx', 'src/app/field/error.tsx', 'src/app/admin/error.tsx']) {
  check(/<RouteError error=\{error\}/.test(read(f)), `${f} explains the cause`)
}
check(/diagnoseAppError/.test(read('src/components/route-error.tsx')) && /reportAppError/.test(read('src/components/route-error.tsx')), 'screen errors explain and report')
check(/EARLY_RECOVERY_SCRIPT/.test(read('src/app/layout.tsx')), 'the early reload runs before the app')
check(/sessionStorage/.test(EARLY_RECOVERY_SCRIPT) && /30000/.test(EARLY_RECOVERY_SCRIPT) && EARLY_RECOVERY_SCRIPT.includes('\\/_next\\/static'),
  'it reloads at most every 30 s, and only for the app’s own files')
const recover = read('src/lib/app-recover.ts')
check(/caches\.delete/.test(recover) && !/indexedDB|serviceWorker\.getRegistrations|unregister/.test(recover), 'reloading clears only the stored copy, never saved work or notifications')
const route = read('src/app/api/client-error/route.ts')
check(/allowAttempt\(/.test(route) && /console\.error\('app screen crashed'/.test(route) && !/email|full_name|user_id/.test(route), 'crashes are logged with their code, rate-limited, nothing about the person')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL APP ERROR CHECKS PASSED')
