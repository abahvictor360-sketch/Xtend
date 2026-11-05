/**
 * Logic checks for the November 2026 security fixes (0079 and the routes
 * around it). No database, no network:
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-security-fixes.ts
 */
import assert from 'node:assert/strict'
import { isOwnStoragePath, MAX_STORAGE_PATH } from '@/lib/storage-path'
import { csvCell, EXPORT_FORMATS, isExportFormat } from '@/lib/export/formats'
import { allowAttempt } from '@/lib/rate-limit'
import {
  ASK_XTEND_PER_HOUR,
  DEFAULT_GOOGLE_MONTHLY_LOOKUP_LIMIT,
  GEOCODE_LOOKUPS_PER_HOUR,
  PHOTO_CHECKS_PER_HOUR,
  SUPPORT_HELPER_REPLIES_PER_HOUR,
  SUPPORT_HELPER_THREAD_MAX,
  supportHelperMode,
} from '@/lib/usage-limits'
import { healthBody, type HealthConfigured } from '@/lib/health'
import { CHANGE_PASSWORD_CODE, currentPasswordRequired, passwordChangeBlocks } from '@/lib/password-gate'
import { authAdminError } from '@/lib/auth-admin-errors'
import { parseLimit } from '@/lib/place-resolve'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

// ---------------------------------------------------------------------
// Own storage paths: no way out of the caller's folder.
// ---------------------------------------------------------------------
const me = '3f2b8c1e-0000-4000-8000-000000000001'
const other = '3f2b8c1e-0000-4000-8000-000000000002'
for (const ok of [
  `${me}/a1b2.jpg`,
  `${me}/a1b2_thumb.jpg`,
  `${me}/xm-count-9e1d.jpg`,
  `${me}/report-photo-abc-123.jpg`,
  `${me}/report-0d3f.pdf`,
  `${me}/count-sheet-1.xlsx`,
  `${me}/folder/inner.jpg`,
]) {
  check(isOwnStoragePath(ok, me), `own path accepted: ${ok}`)
}
for (const bad of [
  `${me}/../${other}/selfie.jpg`,
  `${me}/..`,
  `${me}/./x.jpg`,
  `${me}/.`,
  `${me}//x.jpg`,
  `${me}/`,
  `${me}`,
  `${other}/x.jpg`,
  `${me}x/x.jpg`,
  `/${me}/x.jpg`,
  `${me}/x.jpg/`,
  `${me}/sub/../../${other}/x.jpg`,
  `${me}/%2e%2e/${other}/x.jpg`,
  `${me}/..%2f${other}/x.jpg`,
  `${me}/a b.jpg`,
  `${me}\\..\\${other}\\x.jpg`,
  `${me}/x.jpg?download=1`,
  `${me}/${'a'.repeat(MAX_STORAGE_PATH)}.jpg`,
  '',
]) {
  check(!isOwnStoragePath(bad, me), `path refused: ${JSON.stringify(bad.slice(0, 80))}`)
}
check(!isOwnStoragePath(null, me) && !isOwnStoragePath(42, me) && !isOwnStoragePath(`${me}/x.jpg`, ''),
  'a missing path or a missing user is refused')

// ---------------------------------------------------------------------
// CSV cells cannot run as formulas.
// ---------------------------------------------------------------------
check(csvCell('Ada Okafor') === '"Ada Okafor"', 'csv: a plain value is quoted')
check(csvCell('Say "hi"') === '"Say ""hi"""', 'csv: quotes are doubled')
for (const v of ['=HYPERLINK("http://x","click")', '+2+3', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '=1+1']) {
  check(csvCell(v).startsWith(`"'`), `csv: ${JSON.stringify(v)} is made text`)
}
check(csvCell('-3') === '"-3"' && csvCell('-2.5') === '"-2.5"', 'csv: a plain negative number stays a number')
check(csvCell('') === '""' && csvCell('a=b') === '"a=b"', 'csv: = later in the value is harmless')

// ---------------------------------------------------------------------
// Export formats are checked before anything is audited.
// ---------------------------------------------------------------------
check(EXPORT_FORMATS.join(',') === 'xlsx,docx,pdf,csv', 'export: the four formats renderExport writes')
for (const f of EXPORT_FORMATS) check(isExportFormat(f), `export: ${f} accepted`)
for (const f of ['exe', 'XLSX', 'pdf ', '', 'csv;drop', '../pdf', 'json']) {
  check(!isExportFormat(f), `export: ${JSON.stringify(f)} refused`)
}
check(!isExportFormat(undefined) && !isExportFormat(null), 'export: no format refused')

// ---------------------------------------------------------------------
// Rate limits: the window counts per key.
// ---------------------------------------------------------------------
{
  const key = `check-security:${Date.now()}`
  const answers = Array.from({ length: 5 }, () => allowAttempt(key, 3, 60_000))
  check(answers.join(',') === 'true,true,true,false,false', 'rate limit: the fourth attempt in the window is refused')
  check(allowAttempt(`${key}:someone-else`, 3, 60_000), 'rate limit: another person has their own count')
  const short = `${key}:short`
  allowAttempt(short, 1, 1)
  const until = Date.now() + 5
  while (Date.now() < until) {
    // wait out a 1 ms window
  }
  check(allowAttempt(short, 1, 1), 'rate limit: a new window starts afresh')
}
check(PHOTO_CHECKS_PER_HOUR === 60 && GEOCODE_LOOKUPS_PER_HOUR === 120
  && SUPPORT_HELPER_REPLIES_PER_HOUR === 20 && ASK_XTEND_PER_HOUR === 60 && SUPPORT_HELPER_THREAD_MAX === 12,
  'limits: 60 photo checks, 120 lookups, 20 helper replies and 60 Ask Xtend questions an hour; 12 messages a conversation')
check(supportHelperMode(true, 1) === 'answer' && supportHelperMode(true, 11) === 'answer',
  'support: the helper answers a short conversation within the hour\'s allowance')
check(supportHelperMode(false, 1) === 'office', 'support: past the hourly allowance the office answers')
check(supportHelperMode(true, 12) === 'office' && supportHelperMode(true, 40) === 'office',
  'support: a long conversation goes to a person')

// ---------------------------------------------------------------------
// Google's monthly cap is finite unless switched off.
// ---------------------------------------------------------------------
check(DEFAULT_GOOGLE_MONTHLY_LOOKUP_LIMIT === 20000 && parseLimit(undefined) === 20000 && parseLimit('') === 20000,
  'google: unset means 20,000 a month')
check(parseLimit('5000') === 5000 && parseLimit('0') === null && parseLimit('none') === null,
  'google: a number sets it, 0 or none turns it off')

// ---------------------------------------------------------------------
// /api/health: public shape is { ok, checked_at } only.
// ---------------------------------------------------------------------
{
  const configured: HealthConfigured = {
    supabase_url: true,
    supabase_anon_key: true,
    supabase_service_role: true,
    google_maps: false,
    google_maps_browser: false,
    web_push: false,
    cron_secret: true,
  }
  const at = '2026-11-05T10:00:00.000Z'
  const open = healthBody(false, configured, { present: false }, at)
  check(JSON.stringify(Object.keys(open).sort()) === '["checked_at","ok"]' && open.ok === true,
    'health: the public answer says only whether the app is up')
  const detailed = healthBody(true, configured, { present: false }, at)
  check('configured' in detailed && 'web_push' in detailed && 'place_provider' in detailed,
    'health: with the job secret it lists what is configured')
  check(healthBody(false, { ...configured, supabase_url: false }, null, at).ok === false,
    'health: not ok without Supabase')
}

// ---------------------------------------------------------------------
// Passwords: the forced change gate and the current-password rule.
// ---------------------------------------------------------------------
check(passwordChangeBlocks(true, false), 'password: an API call is refused until a forced change is done')
check(!passwordChangeBlocks(true, true), 'password: except the calls the change itself needs')
check(!passwordChangeBlocks(false, false), 'password: nobody else is affected')
check(CHANGE_PASSWORD_CODE === 'change_password', 'password: the refusal carries code change_password')
check(currentPasswordRequired(false) && !currentPasswordRequired(true),
  'password: the current password is needed, except for the first change after the office set it')

// ---------------------------------------------------------------------
// Account service errors are put in words, never passed on raw.
// ---------------------------------------------------------------------
{
  const quiet = console.error
  console.error = () => undefined
  try {
    const dup = authAdminError({ code: 'email_exists', message: 'A user with this email address has already been registered' })
    check(dup.status === 409 && dup.message === 'Somebody already uses that email.', 'errors: a taken email is said plainly')
    const raw = authAdminError({ message: 'Database error updating user: relation auth.identities' }, 'Fallback.')
    check(raw.message === 'Fallback.' && raw.status === 400, 'errors: anything else gets the fallback, not the service\'s words')
  } finally {
    console.error = quiet
  }
}

console.log(`${passed} checks`)
console.log('ALL SECURITY FIX CHECKS PASSED')
