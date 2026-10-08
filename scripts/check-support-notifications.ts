/**
 * Checks the support inbox logic (src/lib/support-inbox.ts) and the
 * notification history and scheduling helpers (src/lib/notification-log.ts):
 * waits, views, sorting, reply times, quick-reply names, audiences, reach
 * figures and send-later times.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-support-notifications.ts
 */
import {
  answeredOn,
  durationText,
  fillReply,
  inView,
  matchesSearch,
  median,
  minutesWaiting,
  parseSupportFilter,
  replyMinutes,
  sortThreads,
  statusLabel,
  supportQuery,
  viewCounts,
  waitText,
  waitTone,
  type InboxThread,
  type ThreadMessage,
} from '@/lib/support-inbox'
import {
  audienceText,
  deliveryGroups,
  isOverdue,
  lagosAt,
  matchesLog,
  notReached,
  notificationQuery,
  parseNotificationFilter,
  percent,
  scheduleChoices,
  scheduleProblem,
  summarise,
  type Delivery,
  type LogRow,
} from '@/lib/notification-log'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

// Lagos h:m on 8 October 2026 (UTC+1).
const L = (h: number, m = 0, day = 8) => new Date(Date.UTC(2026, 9, day, h - 1, m)).toISOString()
const NOW = new Date(L(12, 0))
const ME = 'me-0000'

function thread(over: Partial<InboxThread>): InboxThread {
  return {
    id: 't',
    user_id: 'u',
    staff_name: 'Ada Okafor',
    staff_role: 'merchandiser',
    subject: 'Cannot clock in',
    status: 'escalated',
    outlet_id: null,
    outlet_name: 'Ikeja City Mall',
    created_at: L(8),
    last_message_at: L(9),
    escalated_at: L(9),
    resolved_at: null,
    resolved_by_name: null,
    assigned_to: null,
    assigned_name: null,
    assigned_at: null,
    message_count: 2,
    last_body: 'I have passed this to the office.',
    last_sender: 'ai',
    last_office_at: null,
    office_replies: 0,
    waiting_since: L(9),
    ...over,
  }
}

// --- Waits ---
const escalated = thread({ id: 'a', waiting_since: L(9) })
check(minutesWaiting(escalated, NOW) === 180, 'escalated at 9:00, now 12:00: three hours waiting', minutesWaiting(escalated, NOW))
check(waitText(180) === 'waiting 3 h' && waitText(45) === 'waiting 45 min' && waitText(90) === 'waiting 1 h 30 min',
  'wait reads as "waiting 3 h", "waiting 45 min", "waiting 1 h 30 min"', [waitText(180), waitText(45), waitText(90)])
check(durationText(2 * 24 * 60 + 5) === '2 days' && durationText(0.4) === 'under a minute', 'days, and under a minute')
check(waitTone(30) === 'ok' && waitTone(60) === 'warn' && waitTone(240) === 'late', 'an hour is a warning, four hours is late')
const answered = thread({ id: 'b', status: 'ai_answered', waiting_since: null, last_sender: 'admin', office_replies: 1, last_message_at: L(11) })
check(minutesWaiting(answered, NOW) === null, 'an answered thread is not waiting')
check(statusLabel(answered).label === 'Office answered' && statusLabel(thread({ status: 'ai_answered' })).label === 'Helper answered',
  'answered by the office is told apart from the helper')
check(statusLabel(escalated).variant === 'destructive' && statusLabel(thread({ status: 'resolved' })).label === 'Closed', 'status labels')

// --- Views and sorting ---
const mine = thread({ id: 'c', status: 'open', waiting_since: L(11, 30), assigned_to: ME, assigned_name: 'Me', last_message_at: L(11, 30) })
const closed = thread({ id: 'd', status: 'resolved', waiting_since: null, last_message_at: L(10), created_at: L(7) })
const longest = thread({ id: 'e', status: 'open', waiting_since: L(7, 15), last_message_at: L(7, 15) })
const all = [escalated, answered, mine, closed, longest]
const counts = viewCounts(all, ME)
check(counts.needs === 3 && counts.mine === 1 && counts.answered === 1 && counts.closed === 1 && counts.all === 5,
  'view counts: 3 need a reply, 1 given to me, 1 answered, 1 closed', counts)
check(inView(mine, 'mine', ME) && !inView(closed, 'mine', ME), 'given to me only while open')
const order = sortThreads(all, 'waiting').map((t) => t.id).join('')
check(order.startsWith('eac'), 'longest waiting first: 7:15, then 9:00, then 11:30', order)
check(order.endsWith('bd'), 'then the rest by latest message', order)
check(sortThreads(all, 'newest')[0].id === 'c' && sortThreads(all, 'oldest')[0].id === 'd', 'newest and oldest orders')

// --- Search ---
check(matchesSearch(escalated, 'ada ikeja') && !matchesSearch(escalated, 'bala'), 'search by name and store')
check(matchesSearch(escalated, 'battery', new Set(['a'])), 'a match inside an older message counts')

// --- Reply times ---
const msgs: ThreadMessage[] = [
  { thread_id: 'x', sender_role: 'staff', created_at: L(8, 0) },
  { thread_id: 'x', sender_role: 'ai', created_at: L(8, 1) },
  { thread_id: 'x', sender_role: 'staff', created_at: L(8, 10) },
  { thread_id: 'x', sender_role: 'admin', created_at: L(8, 40) }, // 40 min after the first unanswered
  { thread_id: 'x', sender_role: 'supervisor', created_at: L(8, 45) }, // a second note: not a reply time
  { thread_id: 'x', sender_role: 'staff', created_at: L(9, 0) },
  { thread_id: 'x', sender_role: 'supervisor', created_at: L(11, 0) }, // 2 h
  { thread_id: 'y', sender_role: 'staff', created_at: L(10, 0) },
  { thread_id: 'y', sender_role: 'admin', created_at: L(10, 10) }, // 10 min
  { thread_id: 'z', sender_role: 'staff', created_at: L(17, 0, 7) },
  { thread_id: 'z', sender_role: 'admin', created_at: L(9, 0) }, // overnight: 16 h, answered today
]
const times = replyMinutes(msgs).sort((a, b) => a - b)
check(JSON.stringify(times) === JSON.stringify([10, 40, 120, 960]), 'reply times run from the first unanswered message', times)
check(median(times) === 80 && median([5]) === 5 && median([]) === null, 'median reply time', median(times))
check(replyMinutes(msgs, new Date(L(10, 30))).length === 1, 'only replies made inside the window count')
check(answeredOn(msgs, '2026-10-08', (iso) => new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 10)) === 3,
  'three threads answered today')

// --- Quick replies ---
check(fillReply('Hello {name}, try again.', 'Ada Okafor') === 'Hello Ada, try again.', '{name} becomes the first name')
check(fillReply('No name here.', '') === 'No name here.', 'a reply without {name} is left alone')

// --- Filters ---
const f = parseSupportFilter({ view: 'closed', sort: 'nonsense', q: '  phone  ', person: 'not-a-uuid' })
check(f.view === 'closed' && f.sort === 'waiting' && f.q === 'phone' && f.person === null, 'support filter is cleaned', f)
check(supportQuery(parseSupportFilter({})) === '' && supportQuery(f, { view: 'needs' }) === 'q=phone', 'defaults stay out of the link')

// --- Notifications: audiences ---
const outlets = new Map([['o1', 'Ikeja City Mall']])
const people = new Map([['p1', 'Ada Okafor'], ['p2', 'Bala Yusuf']])
check(audienceText('everyone', {}) === 'Everyone', 'everyone')
check(audienceText('role', { role: 'merchandiser' }) === 'Merchandisers', 'a role in words')
check(audienceText('outlet', { outlet_id: 'o1' }, { outlets }) === 'Ikeja City Mall', 'an outlet by name')
check(audienceText('users', { user_ids: ['p1', 'p2', 'p3'] }, { people }) === 'Ada Okafor and 2 others', 'named people', audienceText('users', { user_ids: ['p1', 'p2', 'p3'] }, { people }))
check(audienceText('users', { user_ids: ['zz'] }) === '1 person', 'unknown people are counted')

// --- Reach ---
const row = (over: Partial<LogRow>): LogRow => ({
  id: 'n', sender_id: 's', sender_name: 'Ngozi Eze', title: 'Stock', body: 'Delivery at 2pm', url: '/field',
  audience: 'everyone', audience_detail: {}, recipients: 10, delivered: 8, failed: 1, created_at: L(9),
  kind: 'message', read_count: 4, no_device: 1, ...over,
})
const sum = summarise(
  [row({}), row({ id: 'm', recipients: 10, delivered: 10, read_count: 6 }), row({ id: 'old', created_at: L(9, 0, 1) }),
    row({ id: 'alert', kind: 'alert', recipients: 50, delivered: 0 })],
  new Date(L(0, 0, 2)),
)
check(sum.sent === 2 && sum.recipients === 20 && sum.delivered === 18 && sum.deliveryRate === 90 && sum.readRate === 56,
  'this week: office messages only, 90% delivered, 56% read', sum)
check(percent(0, 0) === null && percent(1, 3) === 33, 'percent of nothing is nothing')
const deliveries: Delivery[] = [
  { user_id: 'a', status: 'sent', detail: null, read_at: L(9, 5) },
  { user_id: 'b', status: 'sent', detail: null, read_at: null },
  { user_id: 'c', status: 'failed', detail: 'gone', read_at: null },
  { user_id: 'd', status: 'no_device', detail: null, read_at: null },
]
check(JSON.stringify(notReached(deliveries)) === '["c","d"]', 'send again goes to the failed and the ones with notifications off')
const g = deliveryGroups(deliveries)
check(g.read.length === 1 && g.unread.length === 1 && g.failed.length === 1 && g.off.length === 1, 'who got it, grouped')
check(matchesLog(row({}), 'delivery ngozi') && !matchesLog(row({}), 'meeting'), 'history search')

// --- Scheduling ---
check(lagosAt('2026-10-09', '07:45') === '2026-10-09T06:45:00.000Z', '7:45 in Lagos is 6:45 UTC')
const choices = scheduleChoices(new Date(L(12, 0)))
check(choices[0].label === 'Tomorrow 7:45' && choices[0].date === '2026-10-09' && choices[2].label === 'Today 1 pm',
  'at noon: tomorrow 7:45, today 1 pm', choices)
const late = scheduleChoices(new Date(L(23, 30)))
check(late.every((c) => c.date === '2026-10-09'), 'late at night every choice is tomorrow', late)
const early = scheduleChoices(new Date(L(7, 42)))
check(early[0].label === 'Tomorrow 7:45' && early[1].label === 'Today 8:00', 'three minutes before 7:45 is too close; 8:00 today is fine', early)
check(scheduleProblem(new Date(L(12, 2)), NOW) !== null && scheduleProblem(new Date(L(12, 10)), NOW) === null,
  'at least five minutes ahead')
check(scheduleProblem(new Date(NOW.getTime() + 61 * 86_400_000), NOW) !== null && scheduleProblem(new Date(NaN), NOW) !== null,
  'not more than 60 days, and not a blank time')
check(isOverdue(L(11, 40), NOW) && !isOverdue(L(11, 50), NOW), 'late once 15 minutes past due')

// --- History filter ---
const nf = parseNotificationFilter({ kind: 'alert', days: '90', n: 'bad' })
check(nf.kind === 'alert' && nf.days === 90 && nf.n === null, 'history filter is cleaned', nf)
check(notificationQuery(parseNotificationFilter({})) === '' && notificationQuery(nf, { kind: 'message' }) === 'days=90',
  'history defaults stay out of the link')

console.log(failed ? `\n${failed} FAILED` : '\nALL SUPPORT AND NOTIFICATION CHECKS PASSED')
process.exit(failed ? 1 : 0)
