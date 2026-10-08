import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { AlertsList } from '@/components/admin/alerts-list'
import { PushToggle } from '@/components/field/push-toggle'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Alerts — Xtend' }

/** The tabs look like the app's filter chips; they are links, so pages can be bookmarked. */
const chip = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold transition-all',
    active ? 'bg-brand text-primary-foreground shadow-lift' : 'bg-tint text-tint-foreground hover:brightness-95',
  )
const pill = 'rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint'

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
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          {session.profile.role === 'admin'
            ? 'Everything about every member of staff, newest first.'
            : 'Everything about your team, newest first.'}{' '}
          Filter by what happened, who and when; see who keeps coming up; and open their movement for the day or
          check their excuse from the alert itself.{' '}
          {session.profile.role === 'admin'
            ? 'Tick several alerts to resolve them together with one note.'
            : 'Admins resolve alerts.'}{' '}
          Every resolution is written to the audit log.
        </p>
      </div>

      <PushToggle
        title="Alerts on this device"
        hint="Turn this on to be told the moment somebody clocks in late, leaves their store or does something suspicious. Do it on each computer or phone you use."
      />

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/alerts" aria-current={!activityTab ? 'page' : undefined} className={chip(!activityTab)}>
          Location ({openLocation ?? 0} open)
        </Link>
        <Link
          href="/admin/alerts?show=activity"
          aria-current={activityTab ? 'page' : undefined}
          className={chip(activityTab)}
        >
          Late &amp; suspicious ({activity.length})
        </Link>
      </div>

      {activityTab ? (
        activity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nothing late or suspicious waiting to be reviewed.
          </p>
        ) : (
          <div className="space-y-2">
            {activity.map((flag) => (
              <Card key={flag.id}>
                <CardContent className="flex flex-col gap-2 p-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {flag.staff_name}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {flag.outlet_name ?? 'No outlet'}
                      </span>
                    </p>
                    <p className="text-sm first-letter:uppercase">{flagHeadline(flag.kind)}</p>
                    <p className="text-xs text-muted-foreground">
                      {flag.summary} · {formatLagos(flag.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={flag.severity === 'high' ? 'destructive' : 'warning'}>
                      {flag.severity}
                    </Badge>
                    <Link
                      href="/admin/integrity"
                      className="text-sm font-semibold text-brand underline-offset-2 hover:underline"
                    >
                      Review
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          <form method="get" className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full space-y-1.5 sm:w-36">
                <Label htmlFor="state">Show</Label>
                <Select id="state" name="state" defaultValue={filter.state} className="h-10 text-sm">
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="all">Open and resolved</option>
                </Select>
              </div>
              <div className="w-full space-y-1.5 sm:w-64">
                <Label htmlFor="type">What happened</Label>
                <Select id="type" name="type" defaultValue={filter.type ?? 'all'} className="h-10 text-sm">
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
                <Select id="person" name="person" defaultValue={filter.person ?? 'all'} className="h-10 text-sm">
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
                <Select id="store" name="store" defaultValue={filter.store ?? 'all'} className="h-10 text-sm">
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
                <Input id="from" name="from" type="date" defaultValue={filter.from ?? ''} max={today} className="h-10 w-40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" defaultValue={filter.to ?? ''} max={today} className="h-10 w-40" />
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

          {failed && <Alert variant="destructive">Could not load the alerts: {failed}</Alert>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure
              label={filter.state === 'open' ? 'Open alerts' : filter.state === 'resolved' ? 'Resolved alerts' : 'Alerts'}
              value={String(alerts.length)}
              note={listed.truncated ? 'newest 500 shown' : (range ?? undefined)}
            />
            <Figure label="Still open" value={String(open.length)} warn={open.length > 0} />
            <Figure label={`Open over ${STALE_HOURS} hours`} value={String(stale.length)} warn={stale.length > 0} />
            <Figure
              label="People"
              value={String(grouped.length)}
              note={repeat.length ? `${repeat.length} with ${REPEAT_AT} or more` : undefined}
            />
          </div>

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
            <Alert variant="destructive">
              <p className="font-semibold">Worth a look</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {repeat.slice(0, 6).map((p) => (
                  <li key={p.userId}>
                    <Link href={`?${alertQueryString({ ...filter, person: p.userId })}`} className="font-semibold underline">
                      {p.name}
                    </Link>
                    : {p.total} alerts on {p.days} day{p.days === 1 ? '' : 's'} ({typeMix(p.types)})
                    {p.open ? `, ${p.open} still open` : ''}.{' '}
                    <Link href={alertLinks({ user_id: p.userId, created_at: p.last }).movement} className="underline">
                      Movement on the latest day
                    </Link>
                  </li>
                ))}
                {stale.length > 0 && (
                  <li>
                    {stale.length} alert{stale.length === 1 ? ' has' : 's have'} been open for more than {STALE_HOURS}{' '}
                    hours. The oldest: {stale[stale.length - 1].staff_name}, {formatLagos(stale[stale.length - 1].created_at)}.
                  </li>
                )}
              </ul>
            </Alert>
          )}

          {grouped.length > 1 && (
            <details className="surface group p-4 sm:p-5">
              <summary className="cursor-pointer list-none text-sm font-bold [&::-webkit-details-marker]:hidden">
                By person ({grouped.length}) <span className="font-normal text-muted-foreground">· most alerts first · tap to open</span>
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
    </div>
  )
}

function Figure({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold tabular-nums', warn && 'text-destructive')}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
