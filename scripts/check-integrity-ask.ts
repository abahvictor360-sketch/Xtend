/**
 * Checks the Integrity page's logic (src/lib/integrity-review.ts) and Ask
 * Xtend's kept conversations and coverage (src/lib/assistant-conversations.ts,
 * coverage() in src/lib/assistant-data.ts) without a database or the model.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-integrity-ask.ts
 */
import {
  applyIntegrityFilter,
  countBy,
  detailFacts,
  detailText,
  flagLinks,
  flagsPerDay,
  integrityQueryString,
  integritySheet,
  parseIntegrityFilter,
  personRisk,
  INTEGRITY_COLUMNS,
  MAX_DAYS,
  type FlagRow,
} from '@/lib/integrity-review'
import {
  conversationTitle,
  fromSaved,
  groupConversations,
  savedTurnsSchema,
  toSaved,
  updateConversationSchema,
  type ChatTurnView,
} from '@/lib/assistant-conversations'
import { coverage, nextMonthStart } from '@/lib/assistant-data'
import type { ProposedAction } from '@/lib/assistant-action-types'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

const TODAY = '2026-10-08'
const ADA = '11111111-1111-4111-8111-111111111111'
const BALA = '22222222-2222-4222-8222-222222222222'
const KEMI = '33333333-3333-4333-8333-333333333333'
const MALL = '44444444-4444-4444-8444-444444444444'

let n = 0
const flag = (over: Partial<FlagRow>): FlagRow => ({
  id: `f${++n}`,
  user_id: ADA,
  staff_name: 'Ada Obi',
  kind: 'perfect_accuracy',
  severity: 'medium',
  summary: 'Accuracy 1 m',
  detail: {},
  outlet_id: null,
  outlet_name: null,
  flag_date: TODAY,
  created_at: `${TODAY}T09:00:00+01:00`,
  reviewed_at: null,
  reviewed_by_name: null,
  review_note: null,
  ...over,
})

// --- Filter: defaults, swaps, caps and junk. ---
const def = parseIntegrityFilter({}, TODAY)
check(def.from === '2026-09-09' && def.to === TODAY && def.status === 'open', 'no filter: the last 30 days, to review', def)
const swapped = parseIntegrityFilter({ from: '2026-10-05', to: '2026-10-01' }, TODAY)
check(swapped.from === '2026-10-01' && swapped.to === '2026-10-05', 'a range given backwards is turned round', swapped)
const wide = parseIntegrityFilter({ from: '2025-01-01', to: TODAY }, TODAY)
check(wide.from === '2026-06-11' && wide.to === TODAY, `a range wider than ${MAX_DAYS} days is cut to the last ${MAX_DAYS}`, wide)
const junk = parseIntegrityFilter(
  { from: '2027-01-01', kind: 'made_up', severity: 'huge', person: 'robert', store: MALL, status: 'reviewed', q: '  gps ' },
  TODAY,
)
check(
  junk.to === TODAY && junk.kind === null && junk.severity === null && junk.person === null && junk.store === MALL && junk.status === 'reviewed' && junk.q === 'gps',
  'future dates, unknown kinds, severities and people are ignored; a store id and search are kept',
  junk,
)
const round = parseIntegrityFilter(new URLSearchParams(integrityQueryString({ ...def, kind: 'vpn_suspected', person: BALA, status: 'all' })), TODAY)
check(round.kind === 'vpn_suspected' && round.person === BALA && round.status === 'all' && round.from === def.from, 'the query string reads back the same filter', round)

// --- Filtering in memory. ---
const rows: FlagRow[] = [
  flag({ kind: 'repeated_exact_location', severity: 'high', flag_date: '2026-10-07', detail: { lat: 6.6018, lng: 3.3515, source: 'clock_in' } }),
  flag({ kind: 'repeated_exact_location', severity: 'high', flag_date: '2026-10-05' }),
  flag({ kind: 'vpn_suspected', severity: 'high', flag_date: '2026-10-06', detail: { ip: '1.2.3.4', proxy: true, hosting: false, country: 'NL' } }),
  flag({ kind: 'perfect_accuracy', severity: 'medium', flag_date: '2026-09-20', reviewed_at: '2026-09-21T10:00:00Z', review_note: 'Spoke to her' }),
  flag({ user_id: BALA, staff_name: 'Bala Musa', kind: 'mock_location_confirmed', severity: 'high', flag_date: '2026-09-25', detail: { source: 'background', positions: 4 } }),
  flag({ user_id: KEMI, staff_name: 'Kemi Ade', kind: 'late_clock_in', severity: 'low', flag_date: '2026-10-08', detail: { attendance_id: 'x', minutes: 25 } }),
  flag({
    user_id: KEMI,
    staff_name: 'Kemi Ade',
    kind: 'count_units_missing',
    severity: 'medium',
    flag_date: '2026-09-15',
    outlet_name: 'Ikeja City Mall',
    detail: { products: [{ product: 'Xpel Shampoo', last_left: 20, sold: 5, left: 10, missing: 5 }] },
  }),
]
check(applyIntegrityFilter(rows, def).length === 6, 'to review hides the reviewed flag')
check(applyIntegrityFilter(rows, { ...def, status: 'reviewed' }).length === 1, 'reviewed shows only reviewed flags')
check(applyIntegrityFilter(rows, { ...def, status: 'all', severity: 'high' }).length === 4, 'severity filters')
check(applyIntegrityFilter(rows, { ...def, kind: 'vpn_suspected' }).length === 1, 'kind filters')
check(applyIntegrityFilter(rows, { ...def, status: 'all', q: 'ikeja' }).length === 1, 'search matches the store')
check(applyIntegrityFilter(rows, { ...def, status: 'all', q: 'same gps' }).length === 2, 'search matches the check name')
const kinds = countBy(rows, (r) => r.kind)
check(kinds[0].key === 'repeated_exact_location' && kinds[0].total === 2 && kinds[0].open === 2, 'counts by kind, most first', kinds[0])

// --- Who to look at first. ---
const risk = personRisk(rows, TODAY)
check(risk.length === 3, 'one entry per person with open flags', risk.map((r) => r.name))
check(risk[0].name === 'Ada Obi' && risk[0].level === 'act' && risk[0].open === 3, 'three high flags this week puts Ada first, to act on', risk[0])
check(
  risk[0].reason.startsWith('3 high flags this week:') && risk[0].reason.includes('Same GPS point again on 2 different days') && risk[0].reason.includes('VPN or proxy'),
  'her reason names the repeated GPS point and the VPN',
  risk[0].reason,
)
const bala = risk.find((r) => r.name === 'Bala Musa')!
check(bala.level === 'act' && bala.reason.includes('Includes proof: Fake GPS confirmed') && bala.reason.startsWith('1 open flag, none this week'), 'one old fake-GPS proof is still "act now", and says so', bala)
const kemi = risk.find((r) => r.name === 'Kemi Ade')!
check(kemi.level === 'note' && kemi.lastDate === TODAY, 'a late clock-in and an old count are minor; the last flag day leads the links', kemi)
check(risk[0].score > bala.score && bala.score > kemi.score, 'scores order them', risk.map((r) => r.score))
check(personRisk(rows.map((r) => ({ ...r, reviewed_at: 'x' })), TODAY).length === 0, 'reviewed flags put nobody on the list')

// --- Per day. ---
const days = flagsPerDay(rows, '2026-10-01', TODAY)
check(days.length === 8 && days[0].date === '2026-10-01' && days.at(-1)!.date === TODAY, 'one bar per day in the range', days.length)
const d7 = days.find((d) => d.date === '2026-10-07')!
check(d7.high === 1 && d7.total === 1, 'counted by severity on the flag day', d7)
check(days.reduce((a, d) => a + d.total, 0) === 4, 'flags outside the range are left out')

// --- Detail in words. ---
const gps = detailFacts('repeated_exact_location', rows[0].detail)
check(gps.map === 'https://www.google.com/maps?q=6.6018,3.3515' && gps.facts.some((f) => f.label === 'GPS point') && gps.facts.some((f) => f.value === 'a clock-in'), 'a GPS point gets a map link and the source in words', gps)
const vpn = detailFacts('vpn_suspected', rows[2].detail)
check(vpn.facts.some((f) => f.label === 'VPN or proxy' && f.value === 'Yes') && vpn.facts.some((f) => f.label === 'Country of the internet address' && f.value === 'NL'), 'VPN detail reads as yes/no and a country', vpn.facts)
const late = detailFacts('late_clock_in', rows[5].detail)
check(late.facts.length === 1 && late.facts[0].label === 'Minutes late' && late.facts[0].value === '25 min', 'ids are hidden; minutes late read as minutes', late.facts)
const clock = detailFacts('phone_clock_wrong', { offset_s: -900, taken_at: '2026-10-08T07:30:00Z', how: 'anchor', verdict: 'backdated' })
check(clock.facts.some((f) => f.value === '15 min behind') && clock.facts.some((f) => f.value === 'a later message from the phone') && !clock.facts.some((f) => f.label === 'Verdict'), 'a changed phone clock reads as minutes behind, how we know, no raw verdict', clock.facts)
const missing = detailFacts('count_units_missing', rows[6].detail)
check(missing.products.length === 1 && missing.products[0].missing === 5 && missing.facts.length === 0, 'missing units become product lines', missing)
const odd = detailFacts('impossible_journey', { km: 120.5, minutes: 6, some_new_thing: { a: 1 }, flag: true })
check(odd.facts.some((f) => f.label === 'Distance' && f.value === '120.5 km') && odd.facts.some((f) => f.label === 'Some new thing') && odd.facts.some((f) => f.value === 'Yes'), 'unknown keys still read, never raw JSON', odd.facts)
check(detailText('count_units_missing', rows[6].detail).includes('Xpel Shampoo: 20 left last time, 5 sold, counted 10, 5 missing'), 'one-line detail for the download and the assistant')
check(detailFacts('x', null).facts.length === 0, 'no detail, no facts')

// --- Links. ---
const links = flagLinks(rows[6])
check(
  links[0].href === `/admin/tracking?person=${KEMI}&date=2026-09-15` && links[1].href === `/admin/excuses?person=${KEMI}&date=2026-09-15` && links.some((l) => l.href.startsWith('/admin/store-counts?from=2026-09-15')),
  'each flag links to Movement and the excuse check on its day, and stock counts for a count flag',
  links,
)

// --- The download. ---
const sheet = integritySheet(applyIntegrityFilter(rows, { ...def, status: 'all' }), { ...def, status: 'all' }, TODAY)
check(sheet.rows.every((r) => r.values.length === INTEGRITY_COLUMNS.length) && sheet.widths.xlsx.length === INTEGRITY_COLUMNS.length && sheet.widths.pdf.length === INTEGRITY_COLUMNS.length, 'every row and width matches the columns')
check(sheet.subtitle.includes('7 flags, 6 not yet reviewed') && (sheet.notes ?? '').includes('Look at first: Ada Obi'), 'the subtitle counts, the notes name who to look at first', sheet.subtitle)

// --- Kept conversations. ---
const action: ProposedAction = {
  key: 'notify-1',
  kind: 'notify',
  title: 'Send a notification to 14 merchandisers',
  lines: ['Please clock in'],
  warning: null,
  verb: 'Send',
  payload: { title: 't', body: 'b', url: null, audience: 'everyone', role: null, outlet_id: null, user_ids: [] },
}
const chat: ChatTurnView[] = [
  { role: 'user', content: 'Remind everyone to clock in', file: 'list.csv' },
  {
    role: 'assistant',
    content: 'Check the card below.',
    actions: [action],
    plans: [{ stores: [{ user_id: ADA, user_name: 'Ada', mode: 'add', outlet_ids: [MALL], outlet_names: ['Mall'], current_names: [] }], supervisors: [], unmatched: [] }],
    links: [
      { label: 'Movement', href: '/admin/tracking?person=x' },
      { label: 'Elsewhere', href: 'https://example.com/' },
    ],
    reports: [{ kind: 'daily_attendance', from: TODAY, to: null, name: null, title: 'Today', summary: 'All in' }],
  },
]
const saved = toSaved(chat)
check(!('actions' in saved[1]) && !('plans' in saved[1]), 'kept chats never keep action buttons or plans', saved[1])
check(
  saved[1].earlier?.[0] === 'Send a notification to 14 merchandisers' && saved[1].earlier?.[1] === 'A plan: 1 store allocation',
  'what was proposed is kept as words',
  saved[1].earlier,
)
check(saved[1].links?.length === 1 && saved[1].links[0].href.startsWith('/admin/'), 'only dashboard links are kept', saved[1].links)
check(saved[1].reports?.length === 1 && saved[0].file === 'list.csv', 'reports and file names are kept')
check(savedTurnsSchema.safeParse(saved).success, 'what is kept passes the route check')
check(!savedTurnsSchema.safeParse([{ role: 'assistant', content: 'x', links: [{ label: 'x', href: '//evil.example' }] }]).success, 'the route refuses a link off the dashboard')
check(!updateConversationSchema.safeParse({}).success && updateConversationSchema.safeParse({ title: ' Late staff ' }).success, 'a change must change something; a name is trimmed')
const back = fromSaved([...saved, { role: 'robot', content: 1 }, null])
check(back.length === 2 && back[1].earlier?.length === 2 && !back[1].actions, 'reopened: malformed turns dropped, earlier proposals shown as words', back)
check(toSaved(back).length === 2 && toSaved(back)[1].earlier?.length === 2, 'saving a reopened chat again does not double its words')
check(conversationTitle('  Who   was late?  ') === 'Who was late?', 'a short question is its own name')
const long = conversationTitle('Which of the merchandisers in Ikeja did not visit their allocated stores at all last week and why')
check(long.endsWith('…') && long.length <= 61 && !long.includes('  '), 'a long one is cut at a word', long)
check(conversationTitle('   ') === 'New conversation', 'an empty question gets a plain name')
const groups = groupConversations(
  [
    { id: 'a', title: 'A', updated_at: '2026-10-08T08:00:00Z', turn_count: 2 },
    { id: 'b', title: 'B', updated_at: '2026-10-07T08:00:00Z', turn_count: 2 },
    { id: 'c', title: 'C', updated_at: '2026-10-03T08:00:00Z', turn_count: 2 },
    { id: 'd', title: 'D', updated_at: '2026-08-01T08:00:00Z', turn_count: 4 },
  ],
  TODAY,
  (iso) => iso.slice(0, 10),
)
check(groups.map((g) => `${g.label}:${g.items.map((i) => i.id).join('')}`).join(' ') === 'Today:a Yesterday:b Last 7 days:c Older:d', 'chats grouped by age', groups)

// --- Store coverage. ---
const cov = coverage(
  [
    { id: ADA, full_name: 'Ada Obi', role: 'marketer' },
    { id: BALA, full_name: 'Bala Musa', role: 'marketer' },
    { id: KEMI, full_name: 'Kemi Ade', role: 'merchandiser' },
  ],
  [
    { user_id: ADA, outlet_id: 's1', name: 'Mall' },
    { user_id: ADA, outlet_id: 's2', name: 'Market' },
    { user_id: BALA, outlet_id: 's3', name: 'Plaza' },
  ],
  [
    { user_id: ADA, outlet_id: 's1', name: 'Mall' },
    { user_id: ADA, outlet_id: 's1', name: 'Mall' },
    { user_id: BALA, outlet_id: 's9', name: 'Kiosk' },
  ],
)
check(cov.allocated_stores === 3 && cov.stores_nobody_visited.join() === 'Market,Plaza', 'stores allocated but visited by nobody', cov.stores_nobody_visited)
check(cov.people[0].name === 'Bala Musa' && cov.people[0].coverage_percent === 0 && cov.people[0].visited_outside_allocation[0] === 'Kiosk', 'worst coverage first, with visits outside the allocation', cov.people[0])
const ada = cov.people.find((p) => p.name === 'Ada Obi')!
check(ada.coverage_percent === 50 && ada.visits === 2 && ada.not_visited[0] === 'Market', 'half her stores visited, twice to the mall', ada)
check(!cov.people.some((p) => p.name === 'Kemi Ade'), 'people with no stores and no visits are left out')
check(nextMonthStart('2026-12') === '2027-01-01' && nextMonthStart('2026-02') === '2026-03-01', 'the month after rolls over the year')

console.log(failed ? `\n${failed} FAILED` : '\nALL INTEGRITY AND ASK CHECKS PASSED')
process.exit(failed ? 1 : 0)
