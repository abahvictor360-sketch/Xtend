import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { NotificationComposer, type Template } from '@/components/admin/notification-composer'
import { ScheduledList, type ScheduledItem } from '@/components/admin/notification-tools'
import { Detail, Figure, Reach } from '@/components/admin/notification-history'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  KIND_LABEL,
  audienceText,
  matchesLog,
  notificationQuery,
  parseNotificationFilter,
  summarise,
  type Audience,
  type Delivery,
  type LogRow,
} from '@/lib/notification-log'
import { cn, formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notifications — Xtend' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELD = ['merchandiser', 'marketer']

interface Person {
  id: string
  full_name: string
  role: string
  outlet_id: string | null
}

interface ScheduledRow {
  id: string
  created_by: string | null
  title: string
  body: string
  audience: Audience
  audience_detail: Record<string, unknown>
  user_ids: string[]
  send_at: string
  status: ScheduledItem['status']
  error: string | null
  created_at: string
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const filter = parseNotificationFilter(search)
  const reuse = UUID.test(search.reuse ?? '') ? search.reuse! : null
  const supabase = await createServerSupabase()
  const me = session.userId
  const isAdmin = session.profile.role === 'admin'
  const now = new Date()
  const from = new Date(now.getTime() - filter.days * 86_400_000).toISOString()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)

  const [staffRes, outletsRes, logRes, templatesRes, scheduledRes, reachRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role, outlet_id').eq('is_active', true).order('full_name'),
    supabase.from('outlets').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('notification_log')
      .select('*')
      .gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('notification_templates').select('id, title, body, created_by').order('title'),
    supabase
      .from('scheduled_notifications')
      .select('id, created_by, title, body, audience, audience_detail, user_ids, send_at, status, error, created_at')
      .or(`status.in.(scheduled,sending),and(status.eq.failed,created_at.gte."${weekAgo.toISOString()}")`)
      .order('send_at')
      .limit(50),
    // Everyone this viewer can reach, with their devices: who has notifications off.
    supabase.rpc('resolve_notification_targets', { p_audience: 'everyone', p_detail: {} }),
  ])

  const staff = (staffRes.data ?? []) as Person[]
  const outlets = (outletsRes.data ?? []) as { id: string; name: string }[]
  const names = {
    outlets: new Map(outlets.map((o) => [o.id, o.name])),
    people: new Map(staff.map((p) => [p.id, p.full_name])),
  }
  const missing = logRes.error ? (logRes.error as { code?: string }).code : null
  const log = (logRes.data ?? []) as LogRow[]
  const templates = (templatesRes.data ?? []) as Template[]
  const scheduled = (scheduledRes.data ?? []) as ScheduledRow[]
  const reach = (reachRes.data ?? []) as { user_id: string; full_name: string; role: string; outlet_name: string | null; devices: number }[]
  const off = reach.filter((p) => FIELD.includes(p.role) && p.devices === 0)
  const fieldReach = reach.filter((p) => FIELD.includes(p.role)).length

  const week = summarise(log, weekAgo)
  const rows = log.filter((r) => (filter.kind === 'all' || r.kind === filter.kind) && matchesLog(r, filter.q))
  const kindCounts = {
    message: log.filter((r) => r.kind === 'message').length,
    support: log.filter((r) => r.kind === 'support').length,
    alert: log.filter((r) => r.kind === 'alert').length,
    all: log.length,
  }

  // The one opened, with who got it.
  let opened = filter.n ? (log.find((r) => r.id === filter.n) ?? null) : null
  if (filter.n && !opened) {
    const { data } = await supabase.from('notification_log').select('*').eq('id', filter.n).maybeSingle<LogRow>()
    opened = data ?? null
  }
  let deliveries: Delivery[] = []
  let deliveryNames = new Map<string, string>()
  if (opened) {
    const { data } = await supabase
      .from('notification_deliveries')
      .select('user_id, status, detail, read_at')
      .eq('notification_id', opened.id)
      .limit(1000)
    deliveries = (data ?? []) as Delivery[]
    const unknown = deliveries.map((d) => d.user_id).filter((id) => !names.people.has(id))
    if (unknown.length) {
      const { data: more } = await supabase.from('profiles').select('id, full_name').in('id', unknown)
      deliveryNames = new Map(((more ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))
    }
  }
  const nameOf = (id: string) => names.people.get(id) ?? deliveryNames.get(id) ?? 'Someone'

  // "Use again": the earlier message copied into the composer.
  const reused = reuse ? (log.find((r) => r.id === reuse) ?? null) : null

  const scheduledItems: ScheduledItem[] = scheduled.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body,
    send_at: s.send_at,
    status: s.status,
    error: s.error,
    audienceText: audienceText(s.audience, s.audience_detail, names),
    people: s.user_ids.length,
    byName: s.created_by === me ? 'you' : s.created_by ? (names.people.get(s.created_by) ?? null) : null,
    canManage: isAdmin || s.created_by === me,
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Send a push notification to staff phones, now or at a set time.{' '}
          {session.profile.role === 'supervisor'
            ? 'As a supervisor you can reach the staff in your own team.'
            : 'You can reach everyone, a role, an outlet, or named people.'}{' '}
          Below, see who got each one, who read it in the app, and send it again to anyone it missed.
        </p>
      </div>

      {missing && (
        <Alert variant="warning">
          The history, templates and scheduling need the support and notifications update (053) run in Supabase. You
          can still send now.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Figure label="Sent this week" value={String(week.sent)} note="messages from the office" />
        <Figure label="People reached" value={String(week.delivered)} note={`of ${week.recipients} aimed at`} />
        <Figure label="Delivery rate" value={week.deliveryRate === null ? '—' : `${week.deliveryRate}%`} warn={week.deliveryRate !== null && week.deliveryRate < 80} />
        <Figure label="Read in the app" value={week.readRate === null ? '—' : `${week.readRate}%`} note="of those delivered" />
        <Figure
          label="Notifications off"
          value={String(off.length)}
          note={`of ${fieldReach} field staff`}
          warn={off.length > 0}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      {off.length > 0 && (
        <details className="surface p-4 text-sm">
          <summary className="cursor-pointer font-semibold">
            {off.length} field staff will not get notifications{' '}
            <span className="font-normal text-muted-foreground">· see who</span>
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            They have no phone with Xtend notifications turned on. Ask them to open Xtend and allow notifications;
            until they do they cannot clock in (unless excused) and will not hear from the office.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {off.map((p) => (
              <li key={p.user_id} className="rounded-full border border-border bg-card px-3 py-1 text-xs">
                <span className="font-semibold">{p.full_name}</span>
                {p.outlet_name ? <span className="text-muted-foreground"> · {p.outlet_name}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      <NotificationComposer
        key={reused?.id ?? 'new'}
        staff={staff}
        outlets={outlets}
        templates={templates}
        me={me}
        isAdmin={isAdmin}
        initial={reused ? { title: reused.title, body: reused.body, url: reused.url } : null}
      />

      {scheduledItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled</CardTitle>
            <CardDescription>Waiting to go out. Cancel one, or send it now instead.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduledList items={scheduledItems} now={now.toISOString()} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Newest first. Open one to see who got it, who read it and who did not.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="kind" value={filter.kind} />
            <div className="w-full space-y-1.5 sm:w-60">
              <Label htmlFor="q">Search</Label>
              <Input id="q" name="q" defaultValue={filter.q ?? ''} placeholder="Words in the title or message, sender…" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="days">Over</Label>
              <Select id="days" name="days" defaultValue={String(filter.days)} className="h-10 w-36 text-sm">
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </Select>
            </div>
            <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
              Show
            </button>
          </form>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {(['message', 'support', 'alert', 'all'] as const).map((k) => (
              <Link
                key={k}
                href={`?${notificationQuery(filter, { kind: k, n: null })}`}
                scroll={false}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-semibold',
                  filter.kind === k ? 'bg-brand text-primary-foreground shadow-lift' : 'bg-tint text-tint-foreground hover:brightness-95',
                )}
              >
                {k === 'all' ? 'All' : KIND_LABEL[k]}
                <span className="tabular-nums opacity-80">{kindCounts[k]}</span>
              </Link>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing sent in this time.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const isOpen = opened?.id === row.id
                return (
                  <li key={row.id} className={cn('rounded-2xl border bg-card', isOpen ? 'border-brand/50' : 'border-border')}>
                    <Link
                      href={`?${notificationQuery(filter, { n: isOpen ? null : row.id })}`}
                      scroll={false}
                      className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3 text-sm"
                    >
                      <div className="w-full sm:w-36">
                        <p className="tabular-nums">{formatLagos(row.created_at)}</p>
                        <p className="text-xs text-muted-foreground">{KIND_LABEL[row.kind].replace(/s$/, '')}</p>
                      </div>
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="truncate font-semibold">{row.title}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{row.body}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          To {audienceText(row.audience, row.audience_detail, names)} · by{' '}
                          {row.sender_id === me ? 'you' : (row.sender_name ?? (row.sender_id ? 'the office' : 'Xtend'))}
                          {row.audience_detail?.resend_of ? ' · sent again' : ''}
                          {row.audience_detail?.scheduled_id ? ' · scheduled' : ''}
                        </p>
                      </div>
                      <Reach row={row} />
                    </Link>
                    {isOpen && (
                      <Detail
                        row={row}
                        deliveries={deliveries}
                        nameOf={nameOf}
                        canResend={row.kind === 'message' && (isAdmin || row.sender_id === me)}
                        reuseHref={`?${notificationQuery(filter, { n: null })}&reuse=${row.id}#compose`}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {log.length >= 1000 && (
            <p className="text-xs text-muted-foreground">Showing the newest 1,000. Pick a shorter time to see fewer.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
