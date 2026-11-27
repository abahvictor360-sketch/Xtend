/**
 * Error handling (2026-11-27, migration 0117): every problem is caught,
 * logged without secrets, recorded for System → Problems, and the rest of
 * Xtend keeps working.
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-error-handling.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, dueToRecord, redact, RECORD_EVERY_MS } from '@/lib/log-core'
import { eventName, runJob } from '@/lib/log'
import { isNoise, messageOf } from '@/lib/background-errors'
import { jobState } from '@/lib/job-health'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok  : ${label}`)
  else {
    failed++
    console.log(`FAIL: ${label}`, got ?? '')
  }
}
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function files(dir: string, test: (f: string) => boolean): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`
    return statSync(join(root, p)).isDirectory() ? files(p, test) : test(f) ? [p] : []
  })
}

async function main() {
  // What an error says, whatever was thrown.
  const e = describe(new TypeError('x is undefined'))
  check(e.name === 'TypeError' && e.message === 'x is undefined' && typeof e.stack === 'string', 'an Error gives its name, message and stack')
  check(describe({ message: 'duplicate key', code: '23505' }).name === 'Error 23505', 'a database error gives its code')
  check(describe(null).message === 'Unknown error' && describe('plain').message === 'plain', 'null or text still describes')
  const circular: Record<string, unknown> = {}
  circular.self = circular
  check(describe(circular).message === 'Unreadable error', 'something unreadable never throws')

  // Never a secret in the log.
  const r = redact({ password: 'p', api_key: 'k', Authorization: 'Bearer x', user: 'ada', long: 'y'.repeat(400), nested: { token: 't', ok: 1 } })
  check(r.password === '[hidden]' && r.api_key === '[hidden]' && r.Authorization === '[hidden]' && r.user === 'ada',
    'passwords, keys and tokens are hidden', r)
  check(String(r.long).length <= 301 && (r.nested as Record<string, unknown>).token === '[hidden]', 'long text is cut; nested secrets hidden too')

  // The same problem is recorded once a minute; the log line always.
  const seen = new Map<string, number>()
  check(dueToRecord(seen, 'a', 0) && !dueToRecord(seen, 'a', 1000) && dueToRecord(seen, 'a', RECORD_EVERY_MS + 1) && dueToRecord(seen, 'b', 1000),
    'the same problem is recorded at most once a minute; another is recorded at once')
  check(eventName('flag alerts failed') === 'flag_alerts_failed' && eventName('!!!') === 'problem', 'problems get a plain event name')

  // A job keeps going when a step fails.
  const order: string[] = []
  const job = await runJob('test', {
    one: async () => {
      order.push('one')
      return 1
    },
    two: async () => {
      order.push('two')
      throw new Error('step two broke')
    },
    three: async () => {
      order.push('three')
      return 3
    },
  })
  check(order.join(',') === 'one,two,three' && job.failed.join() === 'two' && job.results.one === 1 && job.results.three === 3,
    'a failing step is recorded and the steps after it still run', job)

  // The browser reports real errors, not noise.
  check(isNoise('ResizeObserver loop completed with undelivered notifications.') && isNoise('TypeError: Failed to fetch')
    && isNoise('Script error.') && isNoise('x', 'chrome-extension://abc/x.js') && isNoise(''),
    'browser quirks, lost connections and extensions are not reported')
  check(!isNoise("TypeError: Cannot read properties of undefined (reading 'lat')"), 'a real bug is reported')
  check(messageOf(new RangeError('bad')) === 'RangeError: bad' && messageOf({ a: 1 }) === '{"a":1}', 'reasons become short messages')

  // Scheduled jobs on System.
  const now = Date.parse('2026-11-27T12:00:00Z')
  const base = { job: 'alerts', last_ok_at: null, last_error: null, last_error_at: null }
  check(jobState(null, 5, now) === 'never', 'never run')
  check(jobState({ ...base, last_run_at: '2026-11-27T11:58:00Z', last_ok_at: '2026-11-27T11:58:00Z' }, 5, now) === 'ok', 'ran on time')
  check(jobState({ ...base, last_run_at: '2026-11-27T11:00:00Z', last_ok_at: '2026-11-27T11:00:00Z' }, 5, now) === 'late', 'the five-minute job silent for an hour is late')
  check(jobState({ ...base, last_run_at: '2026-11-27T11:58:00Z', last_ok_at: '2026-11-27T11:50:00Z', last_error_at: '2026-11-27T11:58:00Z', last_error: 'x' }, 5, now) === 'failing',
    'its last run failed')
  check(jobState({ ...base, job: 'nightly', last_run_at: '2026-11-26T23:00:00Z', last_ok_at: '2026-11-26T23:00:00Z' }, 1440, now) === 'ok', 'a daily job run last night is fine')

  // Every API route answers errors in JSON, never Next's HTML page.
  const routes = files('src/app/api', (f) => f === 'route.ts')
  const bare = routes.filter((p) => !/try \{|withErrors\(|withRedirectOnError\(|xmAdminAction\(|runJob\(/.test(read(p)))
  check(bare.length === 0, `all ${routes.length} API routes catch what they throw`, bare)
  const loose = files('src', (f) => /\.tsx?$/.test(f)).filter((p) => p !== 'src/lib/log.ts' && /console\.error\(/.test(read(p)))
  check(loose.length === 0, 'server problems go through the logger (recorded), not console.error alone', loose)
  check(/<ErrorReporter \/>/.test(read('src/app/layout.tsx')), 'every page reports background errors')
  check(/runJob\('alerts'/.test(read('src/app/api/cron/alerts/route.ts')) && /runJob\('absence_sweep'/.test(read('src/app/api/cron/absence-sweep/route.ts'))
    && /recordJob\('nightly'/.test(read('src/app/api/cron/purge-selfies/route.ts')), 'the scheduled jobs run step by step and record each run')
  check(/logError\('api\.unexpected', error\)/.test(read('src/lib/auth.ts')), 'unexpected API errors are recorded')
  check(/<ProblemsPanel/.test(read('src/app/admin/system/page.tsx')), 'admins see problems and jobs on System')

  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nALL ERROR HANDLING CHECKS PASSED')
}
main()
