import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { AlertsList } from '@/components/admin/alerts-list'
import { PushToggle } from '@/components/field/push-toggle'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  ALERT_LABEL,
  ALERT_SHORT,
  ALERT_TYPES,
  REPEAT_AT,
  STALE_HOURS,
  alertAgeMinutes,
  alertLinks,
  alertPresets,
  alertQueryString,
  byPerson,
  parseAlertFilter,
  repeatOffenders,
  typeCounts,
  typeMix,
} from '@/lib/alert-review'
import { fetchAlerts } from '@/lib/export/alerts'
import { flagHeadline } from '@/lib/flag-labels'
import { movementHref } from '@/lib/visit-review'
import { cn, formatLagos, lagosDateString } from '@/lib/utils'
import { AlarmClock, Bell, CalendarDays, CircleAlert, Hourglass, ShieldAlert, Siren, SlidersHorizontal, Users } from 'lucide-react'
import { Chip, EmptyState, IconTile, PageHeader, SectionTitle, StatCard, StatGrid, TabLinks } from '@/components/admin/page-kit'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Alerts — Xtend' }

const pill = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint'

interface FlagRow {
  id: string
  staff_name: string
  kind: string
  severity: 'medium' | 'high'
  summary: string
  outlet_name: string | null
  created_at: string
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const activityTab = search.show === 'activity'
  const filter = parseAlertFilter(search)
  const today = lagosDateString()
  // Rendered once on the server, so ages read the same after hydration.
  const now = Date.now()

  // RLS narrows all of it to a supervisor's own team.
  const supabase = await createServerSupabase()
  const [listed, { data: flags }, { count: openLocation }, { data: people }, { data: outlets }] = await Promise.all([
    activityTab
      ? Promise.resolve({ alerts: [], truncated: false })
      : fetchAlerts(supabase, filter, 500).catch((e: Error) => ({ alerts: [], truncated: false, error: e.message })),
    // Late in, early out and suspicious activity still to review (036).
    supabase
      .from('integrity_flag_detail')
      .select('id, staff_name, kind, severity, summary, outlet_name, created_at')
      .is('reviewed_at', null)
      .in('severity', ['medium', 'high'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('location_alerts').select('id', { count: 'exact', head: true }).eq('is_resolved', false),
    supabase.from('profiles').select('id, full_name').in('role', ['merchandiser', 'marketer']).order('full_name'),
    supabase.from('outlets').select('id, name').eq('is_active', true).order('name'),
  ])
  const activity = (flags ?? []) as FlagRow[]
  const alerts = listed.alerts
  const failed = 'error' in listed ? listed.error : null

  const counts = typeCounts(alerts)
  const grouped = byPerson(alerts)
  const repeat = repeatOffenders(grouped)
  const open = alerts.filter((a) => !a.is_resolved)
  const stale = open.filter((a) => alertAgeMinutes(a, now) >= STALE_HOURS * 60)
  const query = alertQueryString(filter)
  const presets = alertPresets(filter, today)
  const live = filter.state !== 'resolved' && (!filter.to || filter.to >= today)
  const toggleType = (t: (typeof ALERT_TYPES)[number]) =>
    `?${alertQueryString({ ...filter, type: filter.type === t ? null : t })}`
  const range = filter.from || filter.to ? `${filter.from ?? 'the start'} to ${filter.to ?? 'today'}` : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={session.profile.role === 'admin' ? 'Company review' : 'Team review'}
        title="Alerts"
        note={`Review what happened, check the context, then follow up.${session.profile.role === 'admin' ? ' Resolve one alert or select several together.' : ' Your team only. Admins resolve alerts.'}`}
        chips={
          <>
            {range && <Chip icon={CalendarDays}>{range}</Chip>}
            <Chip icon={Siren}>{openLocation ?? 0} open</Chip>
          </>
        }
      />

      <TabLinks
        tabs={[
          { href: '/admin/alerts', label: <>Location <Count n={openLocation ?? 0} /></>, active: !activityTab },
          { href: '/admin/alerts?show=activity', label: <>Late &amp; suspicious <Count n={activity.length} /></>, active: activityTab },
        ]}
      />

      {activityTab ? (
        activity.length === 0 ? (
          <EmptyState icon={ShieldAlert}>Nothing late or suspicious waiting to be reviewed.</EmptyState>
        ) : (
          <section className="space-y-3">
            <SectionTitle
              icon={ShieldAlert}
              title="Waiting to be reviewed"
              note={`${activity.length} late clock-in${activity.length === 1 ? '' : 's'}, early clock-outs and suspicious activity · newest first`}
            />
            <ul className="grid gap-3 lg:grid-cols-2">
              {activity.map((flag) => (
                <li key={flag.id} className="surface flex items-start gap-3 p-4">
                  <IconTile icon={flag.kind === 'late_clock_in' || flag.kind === 'early_clock_out' ? AlarmClock : ShieldAlert} tone={flag.severity === 'high' ? 'bad' : 'warn'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-semibold">{flag.staff_name}</p>
                      <Badge variant={flag.severity === 'high' ? 'destructive' : 'warning'}>{flag.severity}</Badge>
                    </div>
                    <p className="text-sm first-letter:uppercase">{flagHeadline(flag.kind)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {flag.summary} · {flag.outlet_name ?? 'No outlet'} · {formatLagos(flag.created_at)}
                    </p>
                  </div>
                  <Link href="/admin/integrity" className={buttonVariants({ size: 'sm', variant: 'outline', className: 'shrink-0' })}>
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      ) : (
        <>
          <details className="surface group p-4 sm:p-5" open={Boolean(query)}>
            <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
              <IconTile icon={SlidersHorizontal} />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold">Filters &amp; downloads</span>
                <span className="block text-xs text-muted-foreground">{query ? 'Filters applied' : 'Showing all open alerts'} · tap to {query ? 'change' : 'filter'}</span>
              </span>
            </summary>
          <form method="get" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full space-y-1.5 sm:w-36">
                <Label htmlFor="state">Show</Label>
                <Select id="state" name="state" defaultValue={filter.state} className="h-11 text-sm">
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="all">Open and resolved</option>
                </Select>
              </div>
              <div className="w-full space-y-1.5 sm:w-64">
                <Label htmlFor="type">What happened</Label>
                <Select id="type" name="type" defaultValue={filter.type ?? 'all'} className="h-11 text-sm">
                  <option value="all">Every kind</option>
                  {ALERT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ALERT_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-full space-y-1.5 sm:w-52">
                <Label htmlFor="person">Who</Label>
                <Select id="person" name="person" defaultValue={filter.person ?? 'all'} className="h-11 text-sm">
                  <option value="all">Everyone</option>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-full space-y-1.5 sm:w-52">
                <Label htmlFor="store">Their store</Label>
                <Select id="store" name="store" defaultValue={filter.store ?? 'all'} className="h-11 text-sm">
                  <option value="all">Every store</option>
                  {(outlets ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="from">From</Label>
                <Input id="from" name="from" type="date" defaultValue={filter.from ?? ''} max={today} className="h-11 w-40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" defaultValue={filter.to ?? ''} max={today} className="h-11 w-40" />
              </div>
              <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
                Show
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
              {presets.map((p) => (
                <Link key={p.label} href={p.href} className={pill}>
                  {p.label}
                </Link>
              ))}
              {query && (
                <Link href="/admin/alerts" className="px-2 py-1 font-semibold text-muted-foreground hover:text-foreground">
                  Clear
                </Link>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-muted-foreground">Download:</span>
                {(['xlsx', 'pdf', 'docx', 'csv'] as const).map((f) => (
                  <a key={f} href={`/api/admin/export/alerts/${f}${query ? `?${query}` : ''}`} className={pill}>
                    {{ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' }[f]}
                  </a>
                ))}
              </span>
            </div>
          </form>
          </details>

          {failed && <Alert variant="destructive">Could not load the alerts: {failed}</Alert>}

          <StatGrid>
            <StatCard
              icon={Bell}
              label={filter.state === 'open' ? 'Open alerts' : filter.state === 'resolved' ? 'Resolved alerts' : 'Alerts'}
              value={String(alerts.length)}
              note={listed.truncated ? 'Newest 500 shown' : (range ?? 'In this view')}
            />
            <StatCard
              icon={Siren}
              label="Still open"
              value={String(open.length)}
              tone={open.length ? 'bad' : 'muted'}
              note={open.length ? 'Waiting for follow-up' : 'All followed up'}
              bar={alerts.length ? (open.length / alerts.length) * 100 : null}
            />
            <StatCard
              icon={Hourglass}
              label={`Open over ${STALE_HOURS} hours`}
              value={String(stale.length)}
              tone={stale.length ? 'warn' : 'muted'}
              note={stale.length ? 'Left too long' : 'None left too long'}
              bar={open.length ? (stale.length / open.length) * 100 : null}
            />
            <StatCard
              icon={Users}
              label="People"
              value={String(grouped.length)}
              tone={repeat.length ? 'bad' : 'brand'}
              note={repeat.length ? `${repeat.length} with ${REPEAT_AT} or more` : 'Nobody repeating'}
            />
          </StatGrid>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 font-semibold text-muted-foreground">By kind:</span>
            {ALERT_TYPES.map((t) => (
              <Link
                key={t}
                href={toggleType(t)}
                aria-current={filter.type === t ? 'true' : undefined}
                className={cn(pill, filter.type === t && 'border-brand bg-tint')}
                title={filter.type === t ? 'Show every kind again' : `Only ${ALERT_LABEL[t].toLowerCase()}`}
              >
                {ALERT_SHORT[t]} <span className="tabular-nums text-muted-foreground">{counts[t]}</span>
              </Link>
            ))}
          </div>

          {(repeat.length > 0 || stale.length > 0) && (
            <section className="surface border-l-4 border-l-destructive p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <CircleAlert className="h-5 w-5 text-destructive" />
                <h2 className="text-base font-bold">Worth a look</h2>
              </div>
              <ul className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                {repeat.slice(0, 6).map((p) => (
                  <li key={p.userId} className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <Link href={`?${alertQueryString({ ...filter, person: p.userId })}`} className="font-semibold underline">
                      {p.name}
                    </Link>
                    : {p.total} alerts on {p.days} day{p.days === 1 ? '' : 's'} ({typeMix(p.types)})
                    {p.open ? `, ${p.open} still open` : ''}.{' '}
                    <Link href={alertLinks({ user_id: p.userId, created_at: p.last }).movement} className="font-semibold text-brand hover:underline">
                      Movement on the latest day
                    </Link>
                  </li>
                ))}
                {stale.length > 0 && (
                  <li className="rounded-xl bg-muted/40 px-3 py-2.5">
                    {stale.length} alert{stale.length === 1 ? ' has' : 's have'} been open for more than {STALE_HOURS}{' '}
                    hours. The oldest: {stale[stale.length - 1].staff_name}, {formatLagos(stale[stale.length - 1].created_at)}.
                  </li>
                )}
              </ul>
            </section>
          )}

          {grouped.length > 1 && (
            <details className="surface group p-4 sm:p-5">
              <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                <IconTile icon={Users} />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold">By person ({grouped.length})</span>
                  <span className="block text-xs text-muted-foreground">Most alerts first · tap to open</span>
                </span>
              </summary>
              <ul className="mt-3 divide-y divide-border text-sm">
                {grouped.map((p) => (
                  <li key={p.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                    <span className="min-w-0 flex-1 basis-56">
                      <Link
                        href={`?${alertQueryString({ ...filter, person: p.userId })}`}
                        className="font-semibold hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {typeMix(p.types)} · last {formatLagos(p.last)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={p.total >= REPEAT_AT ? 'destructive' : 'outline'}>{p.total} alerts</Badge>
                      {p.open > 0 && <Badge variant="warning">{p.open} open</Badge>}
                    </span>
                    <span className="flex gap-3 text-xs font-semibold">
                      <Link
                        href={movementHref(p.userId, filter.from ?? lagosDateString(new Date(p.last)), filter.to ?? lagosDateString(new Date(p.last)))}
                        className="text-brand hover:underline"
                      >
                        Movement
                      </Link>
                      <Link href={alertLinks({ user_id: p.userId, created_at: p.last }).excuse} className="text-brand hover:underline">
                        Check an excuse
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <AlertsList
            alerts={alerts}
            canResolve={session.profile.role === 'admin'}
            autoRefresh={live}
            now={now}
            emptyText={
              filter.state === 'resolved'
                ? 'Nothing resolved matches.'
                : query
                  ? 'No alerts match.'
                  : 'No open alerts. All clear.'
            }
          />
        </>
      )}
      <details className="surface p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <IconTile icon={Bell} tone="muted" />
          <span className="text-base font-bold">Notification settings</span>
        </summary>
        <div className="mt-3"><PushToggle title="Alerts on this device" hint="Turn on notifications on each computer or phone where you want to receive alerts." /></div>
      </details>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', n ? 'bg-destructive/10 text-destructive' : 'bg-muted-foreground/15 text-muted-foreground')}>
      {n}
    </span>
  )
}
