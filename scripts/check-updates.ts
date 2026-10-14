/**
 * Checks how Xtend decides what to say about updates (src/lib/app-update.ts):
 * a newer site, a newer or required phone app, "What's new" once, and where
 * each person stands on the Updates page.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-updates.ts
 */
import { buildNumber, decideUpdate, installStatus, shouldShowNotes, type VersionInfo } from '@/lib/app-update'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const now = Date.parse('2026-10-14T10:00:00Z')
const note = { id: 'r1', title: 'Faster pages', notes: '', required: false, created_at: '2026-10-13T09:00:00Z' }
const info = (over: Partial<VersionInfo> = {}): VersionInfo => ({
  build: 'B2',
  android: { latest_build: 60, latest_version: '1.0.60', minimum: null, url: '/download' },
  ios: { latest_build: null, minimum: null, url: null },
  release: note,
  ...over,
})

check(buildNumber('1.0.53') === 53 && buildNumber('53') === 53 && buildNumber(7) === 7, 'build numbers from "1.0.53", "53" or 7')
check(buildNumber('') === null && buildNumber('abc') === null && buildNumber(-1) === null, 'nothing usable gives no build')

let s = decideUpdate(info(), { build: 'B2', platform: null, appBuild: null })
check(s.site === 'current' && s.app === 'current', 'same build in a browser: nothing to do', s)
s = decideUpdate(info(), { build: 'B1', platform: null, appBuild: null })
check(s.site === 'available', 'an older page is offered the update', s)
s = decideUpdate(info({ release: { ...note, required: true } }), { build: 'B1', platform: null, appBuild: null })
check(s.site === 'required', 'a required release makes the update required', s)
s = decideUpdate(info(), { build: '', platform: null, appBuild: null })
check(s.site === 'current', 'a page that does not know its build is not nagged', s)

s = decideUpdate(info(), { build: 'B2', platform: 'android', appBuild: 58 })
check(s.app === 'available' && s.appUrl === '/download' && s.appVersion === '1.0.60', 'an older Android app is offered the new one', s)
s = decideUpdate(info({ android: { latest_build: 60, latest_version: '1.0.60', minimum: 59, url: '/download' } }), { build: 'B2', platform: 'android', appBuild: 58 })
check(s.app === 'required', 'below the lowest build allowed it must be installed', s)
s = decideUpdate(info(), { build: 'B2', platform: 'android', appBuild: 60 })
check(s.app === 'current', 'the newest app is left alone', s)
s = decideUpdate(info({ ios: { latest_build: 5, minimum: 4, url: null } }), { build: 'B2', platform: 'ios', appBuild: 3 })
check(s.app === 'current', 'no iPhone link published: nobody is asked for the impossible', s)
s = decideUpdate(info({ ios: { latest_build: 5, minimum: 4, url: 'https://testflight.apple.com/join/x' } }), { build: 'B2', platform: 'ios', appBuild: 3 })
check(s.app === 'required' && s.appUrl!.startsWith('https://testflight'), 'with a link, an iPhone below the lowest build must update', s)
s = decideUpdate(info(), { build: 'B2', platform: 'android', appBuild: null })
check(s.app === 'current', 'an app too old to say its build is only checked for the site', s)

check(shouldShowNotes(note, null, now), 'new notes are shown')
check(!shouldShowNotes(note, 'r1', now), 'only once')
check(!shouldShowNotes({ ...note, created_at: '2026-09-01T09:00:00Z' }, null, now), 'old notes are not shown to someone new')
check(!shouldShowNotes(null, null, now), 'no notes, nothing shown')

const live = { build: 'B2', android: { latest: 60, minimum: 55 }, ios: { latest: null, minimum: null } }
check(installStatus({ platform: 'android', app_build: 60, web_build: 'B2' }, live) === 'current', 'newest app and site: up to date')
check(installStatus({ platform: 'android', app_build: 60, web_build: 'B1' }, live) === 'old_site', 'newest app, old site: not reloaded yet')
check(installStatus({ platform: 'android', app_build: 57, web_build: 'B2' }, live) === 'old_app', 'older app')
check(installStatus({ platform: 'android', app_build: 50, web_build: 'B2' }, live) === 'must_update', 'below the lowest allowed: must update')
check(installStatus({ platform: 'web', app_build: null, web_build: 'B2' }, live) === 'current', 'a browser on the newest site is up to date')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL UPDATE CHECKS PASSED')
