/**
 * Checks what Ask Xtend may reuse (src/lib/assistant-cache.ts) and the
 * in-memory cache under it (src/lib/ttl-cache.ts): a past day is kept for
 * hours and today for a minute or two, one person's saved answer is never
 * handed to someone who sees different data, follow-ups and files are never
 * served from memory, a failure is never kept, and the cache stays bounded.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-assistant-cache.ts
 */
import {
  ANSWER_TTL_MS,
  CACHEABLE_TOOLS,
  LOOKUP_PAST_TTL_MS,
  LOOKUP_TODAY_TTL_MS,
  answerKey,
  answerWorthSaving,
  lookupKey,
  lookupTtlMs,
  normalizeQuestion,
  stableJson,
} from '@/lib/assistant-cache'
import { TtlCache, namedCache } from '@/lib/ttl-cache'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TODAY = '2026-11-04'

// ---- how long a lookup may be kept ----------------------------------------
check(lookupTtlMs('attendance_on_day', { date: '2026-11-03' }, TODAY) === LOOKUP_PAST_TTL_MS, 'yesterday is kept for hours')
check(lookupTtlMs('attendance_on_day', { date: TODAY }, TODAY) === LOOKUP_TODAY_TTL_MS, 'today is kept for a minute or two')
check(lookupTtlMs('attendance_on_day', { date: '2026-11-09' }, TODAY) === LOOKUP_TODAY_TTL_MS, 'a future day is not kept long')
check(lookupTtlMs('attendance_summary', { from: '2026-10-01', to: '2026-10-31' }, TODAY) === LOOKUP_PAST_TTL_MS, 'a finished range is kept for hours')
check(lookupTtlMs('attendance_summary', { from: '2026-10-01', to: TODAY }, TODAY) === LOOKUP_TODAY_TTL_MS, 'a range that ends today is short')
check(lookupTtlMs('attendance_summary', { from: '2026-10-01', to: null }, TODAY) === LOOKUP_TODAY_TTL_MS, 'a range with no end means "up to today": short')
check(lookupTtlMs('staff_history', { name: 'Ada', from: null, to: null }, TODAY) === LOOKUP_TODAY_TTL_MS, 'no dates at all is short')
check(lookupTtlMs('x_metrics', { month: '2026-10' }, TODAY) === LOOKUP_PAST_TTL_MS, 'a finished month is kept for hours')
check(lookupTtlMs('x_metrics', { month: '2026-11' }, TODAY) === LOOKUP_TODAY_TTL_MS, 'this month is short')
check(lookupTtlMs('support_threads', { status: 'escalated' }, TODAY) === LOOKUP_TODAY_TTL_MS, 'live queues are short')
check(LOOKUP_TODAY_TTL_MS <= 120_000 && LOOKUP_PAST_TTL_MS >= 3_600_000, 'short is at most two minutes, long at least an hour')

// Tools that depend on the turn, or change something, are never kept.
for (const tool of ['match_names', 'integrity_flags', 'count_requests', 'open_page', 'create_report', 'propose_changes', 'propose_notification', 'check_excuse']) {
  check(!CACHEABLE_TOOLS.has(tool) && lookupTtlMs(tool, { date: '2026-01-01' }, TODAY) === 0, `${tool} is never cached`)
}

// ---- keys ------------------------------------------------------------------
check(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }) === stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }), 'the same input is the same key, whatever the key order')
check(lookupKey('admin', 'x_metrics', { month: '2026-10' }) !== lookupKey('sup:1', 'x_metrics', { month: '2026-10' }), "a supervisor's lookup is not an admin's")
check(lookupKey('sup:1', 'x_metrics', { month: '2026-10' }) !== lookupKey('sup:2', 'x_metrics', { month: '2026-10' }), "one supervisor's lookup is not another's")
check(normalizeQuestion('  Who   hasn\'t clocked in TODAY?? ') === "who hasn't clocked in today", 'a question is folded: case, spaces, trailing marks')

const ask = (content: string) => [{ role: 'user', content }]
const k1 = answerKey('admin', TODAY, ask('Who hasn\'t clocked in today?'), false)
check(k1 !== null && k1 === answerKey('admin', TODAY, ask("who hasn't  clocked in today"), false), 'the same question typed a little differently matches')
check(k1 !== answerKey('sup:1', TODAY, ask('Who hasn\'t clocked in today?'), false), "a supervisor never gets an admin's saved answer")
check(k1 !== answerKey('admin', '2026-11-05', ask('Who hasn\'t clocked in today?'), false), 'a saved answer does not outlive the day')
check(answerKey('admin', TODAY, [...ask('a'), { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], false) === null, 'a follow-up is never saved or served from memory')
check(answerKey('admin', TODAY, ask('Read this'), true) === null, 'a question with a file is never saved or served from memory')
check(answerKey('admin', TODAY, ask('   '), false) === null, 'an empty question has no key')

// ---- what is worth saving --------------------------------------------------
const base = { plans: 0, actions: 0, reports: 0, lookupFailed: false, answered: true }
check(answerWorthSaving(base), 'a plain answer is saved')
check(!answerWorthSaving({ ...base, actions: 1 }), 'an answer with an action card is not saved')
check(!answerWorthSaving({ ...base, plans: 1 }), 'an answer with a change plan is not saved')
check(!answerWorthSaving({ ...base, reports: 1 }), 'an answer with a report is not saved')
check(!answerWorthSaving({ ...base, lookupFailed: true }), 'an answer after a failed lookup is not saved')
check(!answerWorthSaving({ ...base, answered: false }), 'a turn with no answer text is not saved')
check(ANSWER_TTL_MS <= 10 * 60_000, 'a saved answer is kept for minutes, not longer')

// ---- the cache itself ------------------------------------------------------
async function cacheChecks() {
  const c = new TtlCache<string>(3)
  c.set('a', '1', 40)
  check(c.get('a') === '1', 'a kept value comes back')
  await sleep(60)
  check(c.get('a') === undefined, 'a value is forgotten when its time is up')

  c.set('zero', 'x', 0)
  check(c.get('zero') === undefined, 'a time of zero keeps nothing')

  const small = new TtlCache<number>(3)
  for (const [i, k] of ['a', 'b', 'c'].entries()) small.set(k, i, 10_000)
  small.get('a') // a is now the most recently used
  small.set('d', 9, 10_000)
  check(small.get('b') === undefined && small.get('a') === 0 && small.get('d') === 9, 'at the limit the least recently used goes first', [small.get('a'), small.get('b'), small.get('d')])

  let loads = 0
  const slow = () => new Promise<string>((r) => setTimeout(() => (loads += 1, r('v')), 30))
  const d = new TtlCache<string>()
  const both = await Promise.all([d.remember('k', 10_000, slow), d.remember('k', 10_000, slow)])
  check(loads === 1 && both[0] === 'v' && both[1] === 'v', 'two people asking at once cause one load', loads)
  await d.remember('k', 10_000, slow)
  check(loads === 1, 'the next caller is served from memory', loads)

  let tries = 0
  const flaky = new TtlCache<string>()
  const first = await flaky.remember('k', 10_000, async () => { tries += 1; throw new Error('db down') }).catch((e: Error) => e.message)
  const second = await flaky.remember('k', 10_000, async () => { tries += 1; return 'ok' })
  check(first === 'db down' && second === 'ok' && tries === 2, 'a failure is not kept: the next caller tries again', { first, second, tries })

  let calls = 0
  const picky = new TtlCache<{ ok: boolean }>()
  const load = async () => ({ ok: (calls += 1) > 1 })
  await picky.remember('k', (v) => (v.ok ? 10_000 : 0), load)
  const again = await picky.remember('k', (v) => (v.ok ? 10_000 : 0), load)
  check(calls === 2 && again.ok, 'a value the caller marks as bad (ttl 0) is not kept', calls)

  check(namedCache('x') === namedCache('x') && namedCache('x') !== namedCache('y'), 'a name always gives the same cache')
}

async function main() {
  await cacheChecks()
  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nALL ASSISTANT CACHE CHECKS PASSED')
}

void main()
