/**
 * Logic checks for zero trust (migration 0080, src/lib/zero-trust.ts):
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-zero-trust.ts
 *
 * Office sign-in limits, the two-step sign-in step, the origin check on
 * changes and the new-device line. The database half (is_admin/is_hr need
 * the code step, recent confirmations) is in supabase/tests/rules.sql.
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_MFA_ROLES,
  OFFICE_IDLE_MINUTES,
  OFFICE_ROLES,
  OFFICE_SESSION_HOURS,
  RECONFIRM_MINUTES,
  deviceLine,
  mfaStep,
  officeRelogin,
  originAllowed,
} from '../src/lib/zero-trust'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

const now = Date.parse('2026-11-10T12:00:00Z')
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()
const minutesAgoMs = (m: number) => now - m * 60_000

// --- Settings ---------------------------------------------------------------
check(OFFICE_SESSION_HOURS === 12 && OFFICE_IDLE_MINUTES === 60, 'office: 12 hours at most, 60 minutes idle')
check(RECONFIRM_MINUTES === 10, 'risky actions: password confirmed in the last 10 minutes')
check(OFFICE_ROLES.join() === 'supervisor,admin,hr', 'office roles: supervisor, admin, HR')
check(DEFAULT_MFA_ROLES.join() === 'admin,hr', 'two-step sign-in needed by default for admin and HR')

// --- Office session limits ---------------------------------------------------
for (const role of ['merchandiser', 'marketer'] as const) {
  check(
    officeRelogin({ role, lastSignInAt: hoursAgo(30), lastSeenMs: minutesAgoMs(600), now }) === null,
    `${role}: office limits never apply (their own daily rules do)`,
  )
}
for (const role of OFFICE_ROLES) {
  check(officeRelogin({ role, lastSignInAt: hoursAgo(1), lastSeenMs: minutesAgoMs(5), now }) === null, `${role}: busy and recent is fine`)
  check(officeRelogin({ role, lastSignInAt: hoursAgo(13), lastSeenMs: minutesAgoMs(1), now }) === 'office-time', `${role}: 13 hours after sign-in ends it, however busy`)
  check(officeRelogin({ role, lastSignInAt: hoursAgo(2), lastSeenMs: minutesAgoMs(61), now }) === 'idle', `${role}: 61 minutes with no request ends it`)
}
check(officeRelogin({ role: 'admin', lastSignInAt: hoursAgo(11.9), lastSeenMs: minutesAgoMs(59), now }) === null, 'just inside both limits is fine')
check(officeRelogin({ role: 'admin', lastSignInAt: hoursAgo(2), lastSeenMs: null, now }) === null, 'no last-seen yet (first request) is not idle')
check(officeRelogin({ role: 'admin', lastSignInAt: null, lastSeenMs: minutesAgoMs(1), now }) === 'office-time', 'no sign-in time: sign in again')
check(officeRelogin({ role: 'admin', lastSignInAt: 'garbage', lastSeenMs: minutesAgoMs(1), now }) === 'office-time', 'unreadable sign-in time: sign in again')
check(officeRelogin({ role: 'hr', lastSignInAt: hoursAgo(13), lastSeenMs: minutesAgoMs(90), now }) === 'office-time', 'both run out: the 12-hour reason wins')

// --- Two-step sign-in ----------------------------------------------------------
check(mfaStep({ required: true, enrolled: false, aal: 'aal1' }) === 'setup', 'needed and not set up: set it up')
check(mfaStep({ required: true, enrolled: true, aal: 'aal1' }) === 'challenge', 'set up, no code yet this sign-in: enter the code')
check(mfaStep({ required: true, enrolled: true, aal: 'aal2' }) === null, 'code entered: carry on')
check(mfaStep({ required: false, enrolled: true, aal: 'aal1' }) === 'challenge', 'chose it (supervisor): the code is asked too')
check(mfaStep({ required: false, enrolled: false, aal: 'aal1' }) === null, 'not needed, not set up: nothing')
check(mfaStep({ required: true, enrolled: true, aal: null }) === 'challenge', 'unknown level counts as no code')

// --- Origin check --------------------------------------------------------------
const base = { method: 'POST', path: '/api/admin/users', host: 'xtend.example.com', origin: null, secFetchSite: null }
check(originAllowed({ ...base, origin: 'https://xtend.example.com' }), 'own pages may change things')
check(originAllowed({ ...base, origin: 'https://XTEND.example.com', host: 'xtend.EXAMPLE.com' }), 'host is compared without case')
check(!originAllowed({ ...base, origin: 'https://evil.example.net' }), 'another site is refused')
check(!originAllowed({ ...base, origin: 'https://xtend.example.com.evil.net' }), 'a look-alike host is refused')
check(!originAllowed({ ...base, origin: 'https://xtend.example.com:8443' }), 'another port is refused')
check(!originAllowed({ ...base, origin: 'null' }), 'a hidden origin (sandboxed frame) is refused')
check(!originAllowed({ ...base, origin: 'not a url' }), 'an unreadable origin is refused')
check(!originAllowed({ ...base, origin: 'https://xtend.example.com', host: null }), 'no host to compare with is refused')
check(!originAllowed({ ...base, secFetchSite: 'cross-site' }), 'cross-site with no origin is refused')
check(!originAllowed({ ...base, secFetchSite: 'same-site' }), 'a sister subdomain with no origin is refused')
check(originAllowed({ ...base, secFetchSite: 'same-origin' }), 'same-origin with no origin header is fine')
check(originAllowed(base), 'no browser headers at all (not a browser, carries no cookies) is fine')
for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
  check(originAllowed({ ...base, method, origin: 'https://evil.example.net' }), `${method} never changes anything, so it passes`)
}
for (const method of ['PUT', 'PATCH', 'DELETE']) {
  check(!originAllowed({ ...base, method, origin: 'https://evil.example.net' }), `${method} from another site is refused`)
}
check(originAllowed({ ...base, path: '/login', origin: 'https://evil.example.net' }), 'pages (not /api) are left to Next.js')
check(originAllowed({ ...base, path: '/api/cron/remind', origin: 'https://evil.example.net' }), 'scheduled jobs (bearer secret) are exempt')
check(originAllowed({ ...base, path: '/api/track/point', origin: 'https://evil.example.net' }), 'the native tracker (its own token) is exempt')
check(!originAllowed({ ...base, path: '/api/cronx', origin: 'https://evil.example.net' }), 'only the exact exempt folders are exempt')

// --- New-device line ------------------------------------------------------------
check(deviceLine(null) === 'an unknown phone or computer', 'no description: unknown device')
check(deviceLine({ type: 'phone', os: 'Android', browser: 'Chrome', app: false }) === 'Chrome on Android (phone)', 'browser on a phone')
check(deviceLine({ type: 'phone', os: 'iOS', browser: 'Safari', app: true }) === 'the Xtend app on iOS (phone)', 'the app is named as the app')
check(deviceLine({ type: 'computer', os: null, browser: null, app: false }) === 'a computer', 'nothing known but the kind')

console.log(`\nALL ${passed} ZERO TRUST CHECKS PASSED`)
