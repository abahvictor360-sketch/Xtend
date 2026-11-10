/**
 * Checks how Xtend decides what to say about updates (src/lib/app-update.ts):
 * a newer site, a newer or required phone app, "What's new" once, and where
 * each person stands on the Updates page.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-updates.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildNumber, decideUpdate, installStatus, shouldShowNotes, type VersionInfo } from '@/lib/app-update'
import { lagosHour, noticeHour, updateNoticeMessage } from '@/lib/app-update-notice'

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

// --- Telling people about a new phone app (0082).
check(lagosHour(new Date('2026-11-10T05:59:00Z')) === 6 && lagosHour(new Date('2026-11-10T23:30:00Z')) === 0,
  'Lagos is an hour ahead of UTC')
check(!noticeHour(new Date('2026-11-10T05:30:00Z')) && noticeHour(new Date('2026-11-10T06:00:00Z'))
  && noticeHour(new Date('2026-11-10T18:59:00Z')) && !noticeHour(new Date('2026-11-10T19:00:00Z')),
  'the new-app notice is sent from 07:00 to 19:59 Lagos time, never at night')
{
  const first = updateNoticeMessage('android', '1.0.124', 1)
  const again = updateNoticeMessage('android', '1.0.124', 2)
  const ios = updateNoticeMessage('ios', null, 1)
  check(first.title === 'A new Xtend app is ready' && first.body.startsWith('Xtend 1.0.124 is ready to install.')
    && /Get it/.test(first.body) && first.title.length <= 80 && first.body.length <= 400,
    'the first notice names the version and says where to get it', first)
  check(again.title === 'Please update Xtend', 'a reminder says so', again)
  check(ios.body.startsWith('A new Xtend app is ready to install.') && /TestFlight/.test(ios.body), 'iPhone: TestFlight', ios)
  check(!/monitor|track|location/i.test(first.body + again.body + ios.body), 'the notice says nothing about monitoring')
}
{
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  const manager = read('src/components/update-manager.tsx')
  check(!/xt_snooze/.test(manager) && /setSnoozed\(\{ site: 0, app: 0 \}\)/.test(manager) && /SNOOZE_MS = 15 \* 60_000/.test(manager),
    '"Later" lasts only until Xtend is opened again (15 minutes at most), and is never kept')
  check(/await flushAppUpdateNotices\(\)/.test(read('src/app/api/cron/alerts/route.ts')),
    'the five-minute job sends the new-app notices')
}

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL UPDATE CHECKS PASSED')
