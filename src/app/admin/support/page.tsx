import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { AutoRefresh } from '@/components/admin/movement-map'
import {
  SupportThreadPanel,
  type Assignee,
  type PanelMessage,
  type QuickReply,
} from '@/components/admin/support-threads'
import { Figure, PersonContext, ThreadRow, type PanelInfo } from '@/components/admin/support-inbox'
import {
  LONG_WAIT_MIN,
  SORTS,
  SORT_LABEL,
  VIEWS,
  VIEW_LABEL,
  answeredOn,
  durationText,
  inView,
  matchesSearch,
  median,
  minutesWaiting,
  needsReply,
  parseSupportFilter,
  replyMinutes,
  sortThreads,
  supportQuery,
  viewCounts,
  type InboxThread,
  type SupportSender,
  type ThreadMessage,
} from '@/lib/support-inbox'
import { cn, formatLagos, lagosDateString } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Support — Xtend' }

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const filter = parseSupportFilter(await searchParams)
  const supabase = await createServerSupabase()
  const me = session.userId
  const now = new Date()
  const today = lagosDateString(now)
  const since = new Date(now.getTime() - 7 * 86_400_000)
  // Two weeks of messages, so a question asked before the week still counts
  // when it was answered inside it.
  const fetchFrom = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const like = filter.q ? `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null

  // RLS narrows a supervisor to their own team; an admin sees everyone.
  const [inboxRes, recentRes, quickRes, hitsRes] = await Promise.all([
    supabase.from('support_inbox').select('*').order('last_message_at', { ascending: false }).limit(500),
    supabase
      .from('support_messages')
      .select('thread_id, sender_role, created_at')
      .gte('created_at', fetchFrom)
      .order('created_at', { ascending: true })
      .limit(5000),
    supabase.from('support_quick_replies').select('id, title, body, created_by').order('title'),
    like
      ? supabase.from('support_messages').select('thread_id').ilike('body', like).limit(500)
      : Promise.resolve({ data: [] as { thread_id: string }[], error: null }),
  ])

  if (inboxRes.error) {
    const e = inboxRes.error as { code?: string; message: string }
    return (
      <div className="space-y-5">
        <Header />
        <Alert variant="destructive">
          {e.code === '42P01' || e.code === 'PGRST205'
            ? 'This page needs the support and notifications update (053) run in Supabase.'
            : `Could not load support: ${e.message}`}
        </Alert>
      </div>
    )
  }

  const all = (inboxRes.data ?? []) as InboxThread[]
  const recent = (recentRes.data ?? []) as ThreadMessage[]
  const quickReplies = (quickRes.data ?? []) as QuickReply[]
  const hits = new Set(((hitsRes.data ?? []) as { thread_id: string }[]).map((h) => h.thread_id))

  // Summary over everything the viewer can see.
  const waiting = all.filter(needsReply)
  const longWaits = waiting.filter((t) => (minutesWaiting(t, now) ?? 0) >= LONG_WAIT_MIN).length
  const answeredToday = answeredOn(recent, today, (iso) => lagosDateString(new Date(iso)))
  const replyTimes = replyMinutes(recent, since)
  const typical = median(replyTimes)

  // The list: person and search first, then the view.
  const people = [...new Map(all.map((t) => [t.user_id, t.staff_name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )
  const narrowed = all.filter(
    (t) => (!filter.person || t.user_id === filter.person) && (!filter.q || matchesSearch(t, filter.q, hits)),
  )
  const counts = viewCounts(narrowed, me)
  const list = sortThreads(
    narrowed.filter((t) => inView(t, filter.view, me)),
    filter.sort,
  )

  // The open thread and everything beside it.
  let selected = filter.thread ? (all.find((t) => t.id === filter.thread) ?? null) : null
  if (filter.thread && !selected) {
    const { data } = await supabase.from('support_inbox').select('*').eq('id', filter.thread).maybeSingle<InboxThread>()
    selected = data ?? null
  }
  const panel = selected ? await loadPanel(supabase, selected, today) : null
  const backHref = `?${supportQuery(filter, { thread: null })}`

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={60} />
      <Header />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Needs a reply" value={String(waiting.length)} warn={waiting.length > 0} />
        <Figure
          label={`Waiting over ${LONG_WAIT_MIN / 60} hour`}
          value={String(longWaits)}
          warn={longWaits > 0}
        />
        <Figure label="Answered today" value={String(answeredToday)} />
        <Figure
          label="Typical reply time, 7 days"
          value={typical === null ? '—' : durationText(typical)}
          note={replyTimes.length ? `from ${replyTimes.length} repl${replyTimes.length === 1 ? 'y' : 'ies'}` : 'no replies yet'}
        />
      </div>

      <form method="get" className="space-y-3">
        <input type="hidden" name="view" value={filter.view} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="person">Who</Label>
            <Select id="person" name="person" defaultValue={filter.person ?? ''} className="h-10 text-sm">
              <option value="">Everyone</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-64">
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={filter.q ?? ''} placeholder="Words in any message, a name, a store…" className="h-10" />
          </div>
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="sort">Order</Label>
            <Select id="sort" name="sort" defaultValue={filter.sort} className="h-10 text-sm">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Show
          </button>
          {(filter.person || filter.q || filter.sort !== 'waiting') && (
            <Link href="/admin/support" className="flex h-10 items-center px-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={`?${supportQuery(filter, { view: v, thread: null })}`}
              scroll={false}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all',
                filter.view === v ? 'bg-brand text-primary-foreground shadow-lift' : 'bg-tint text-tint-foreground hover:brightness-95',
              )}
            >
              {VIEW_LABEL[v]}
              <span className={cn('tabular-nums', filter.view === v ? 'opacity-90' : 'opacity-70')}>{counts[v]}</span>
            </Link>
          ))}
        </div>
      </form>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className={cn('space-y-2', selected && 'hidden lg:block')} aria-label="Threads">
          {list.length === 0 ? (
            <div className="surface p-6 text-center text-sm text-muted-foreground">
              {filter.view === 'needs' && !filter.q && !filter.person
                ? 'Nothing waiting. New issues from the field appear here.'
                : 'Nothing matches.'}
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map((t) => (
                <li key={t.id}>
                  <ThreadRow t={t} me={me} now={now} today={today} active={selected?.id === t.id} href={`?${supportQuery(filter, { thread: t.id })}`} />
                </li>
              ))}
            </ul>
          )}
          {all.length >= 500 && (
            <p className="text-xs text-muted-foreground">Showing the 500 most recent threads. Search or pick a person to go further back.</p>
          )}
        </section>

        <section className={cn('surface p-4 sm:p-5', !selected && 'hidden lg:block')} aria-label="Conversation">
          {selected && panel ? (
            <SupportThreadPanel
              thread={selected}
              messages={panel.messages}
              quickReplies={quickReplies}
              assignees={panel.assignees}
              me={me}
              isAdmin={session.profile.role === 'admin'}
              notificationsOn={panel.devices === null ? null : panel.devices > 0}
              backHref={backHref}
              now={now.toISOString()}
              context={<PersonContext thread={selected} info={panel} today={today} />}
            />
          ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Pick a thread</p>
              <p>The conversation, who the person is and how their day is going show here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Support</h1>
      <p className="text-sm text-muted-foreground">
        Issues field staff raised in the app. The Xtend helper answers the simple ones; anything marked{' '}
        <span className="font-medium">With the office</span> needs a person. Longest waiting is at the top. Reply here
        and the person gets it in their app; give a thread to a colleague, close it when it is sorted, and reopen it if
        it is not.
      </p>
    </div>
  )
}

type Server = Awaited<ReturnType<typeof createServerSupabase>>

async function loadPanel(supabase: Server, t: InboxThread, today: string): Promise<PanelInfo> {
  const [msgRes, profileRes, attendanceRes, targetsRes, assigneesRes, othersRes] = await Promise.all([
    supabase
      .from('support_messages')
      .select('id, sender_id, sender_role, body, created_at')
      .eq('thread_id', t.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('profiles')
      .select('phone, outlet_id, supervisor_id, is_active')
      .eq('id', t.user_id)
      .maybeSingle<{ phone: string | null; outlet_id: string | null; supervisor_id: string | null; is_active: boolean }>(),
    supabase
      .from('attendance')
      .select('type, status, created_at')
      .eq('user_id', t.user_id)
      .eq('attendance_date', today)
      .order('created_at'),
    // The database decides whether this viewer may reach them, and counts devices.
    supabase.rpc('resolve_notification_targets', { p_audience: 'users', p_detail: { user_ids: [t.user_id] } }),
    supabase.rpc('support_assignees', { p_thread: t.id }),
    supabase.from('support_threads').select('id', { count: 'exact', head: true }).eq('user_id', t.user_id),
  ])

  const raw = (msgRes.data ?? []) as {
    id: string
    sender_id: string | null
    sender_role: SupportSender
    body: string
    created_at: string
  }[]
  const officeIds = [...new Set(raw.filter((m) => m.sender_role === 'admin' || m.sender_role === 'supervisor').map((m) => m.sender_id).filter(Boolean))] as string[]
  const profile = profileRes.data
  const nameOf = async (id: string | null | undefined) =>
    id ? (((await supabase.rpc('office_name', { p: id })).data as string | null) ?? null) : null
  const [names, supervisorName, store] = await Promise.all([
    Promise.all(officeIds.map(async (id) => [id, await nameOf(id)] as const)),
    nameOf(profile?.supervisor_id),
    profile?.outlet_id
      ? supabase.from('outlets').select('name').eq('id', profile.outlet_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
  ])
  const nameMap = new Map(names)
  const target = ((targetsRes.data ?? []) as { devices: number }[])[0]

  return {
    messages: raw.map((m) => ({
      id: m.id,
      sender_role: m.sender_role,
      sender_name: m.sender_id ? (nameMap.get(m.sender_id) ?? null) : null,
      body: m.body,
      created_at: m.created_at,
    })),
    assignees: (assigneesRes.data ?? []) as Assignee[],
    devices: target ? target.devices : targetsRes.error ? null : 0,
    phone: profile?.phone ?? null,
    supervisorName,
    storeName: store.data?.name ?? t.outlet_name,
    active: profile?.is_active ?? true,
    attendance: (attendanceRes.data ?? []) as PanelInfo['attendance'],
    otherThreads: Math.max(0, (othersRes.count ?? 1) - 1),
  }
}
