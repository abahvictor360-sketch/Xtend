/**
 * Checks the "use the app" rule (src/lib/app-only.ts, migration 0084): an
 * admin can require a merchandiser or marketer to use the phone app, so a
 * browser is refused, while the apps, office accounts and everyone not
 * marked are never held back.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-app-only.ts
 */
import { APP_ONLY_MESSAGE, appOnlyBlocks } from '@/lib/app-only'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}

const CHROME = 'Mozilla/5.0 (Linux; Android 15; TECNO KM7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Mobile Safari/537.36'
const APP = `${CHROME} XtendApp`
const IPHONE_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 XtendApp'

// Required to use the app: a browser is refused, the apps get through.
for (const role of ['merchandiser', 'marketer']) {
  check(appOnlyBlocks({ role, app_only: true }, CHROME), `a ${role} marked app-only is refused in a browser`)
  check(!appOnlyBlocks({ role, app_only: true }, APP), `a ${role} marked app-only gets into the Android app`)
  check(!appOnlyBlocks({ role, app_only: true }, IPHONE_APP), `a ${role} marked app-only gets into the iPhone app`)
}
check(appOnlyBlocks({ role: 'marketer', app_only: true }, null), 'a request with no user agent is not the app, so it is refused')
check(appOnlyBlocks({ role: 'marketer', app_only: true }, ''), 'an empty user agent is not the app, so it is refused')

// Not marked: never held back.
check(!appOnlyBlocks({ role: 'merchandiser', app_only: false }, CHROME), 'a person not marked app-only uses a browser as before')
check(!appOnlyBlocks({ role: 'merchandiser' }, CHROME), 'a profile without the setting (before 0084) is not held back')
check(!appOnlyBlocks({ role: 'merchandiser', app_only: null }, CHROME), 'an empty setting is not held back')

// Office accounts always use the web, whatever the flag says.
for (const role of ['admin', 'supervisor', 'hr']) {
  check(!appOnlyBlocks({ role, app_only: true }, CHROME), `a ${role} is never held to app-only, even if the flag is set`)
}

// Nobody signed in has nothing to refuse.
check(!appOnlyBlocks(null, CHROME), 'no profile is not held back')
check(!appOnlyBlocks(undefined, CHROME), 'an unknown profile is not held back')

check(/Download/i.test(APP_ONLY_MESSAGE) || /download/.test(APP_ONLY_MESSAGE), 'the refusal tells them to download the app')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL APP ONLY CHECKS PASSED')
