import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { flagHeadline } from '@/lib/flag-labels'
import { formatLagos, lagosDateString, longDate, metres } from '@/lib/utils'
import { DayCorrections } from '@/components/admin/day-corrections'
import { VisitPhotoList, toDayVisit } from '@/components/admin/visit-photo-list'
import { signSelfies } from '@/lib/export/data'
import type { VisitRow } from '@/lib/visit-review'
import { CORRECTION_LABELS, type CorrectionAction } from '@/lib/field-corrections'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Day overview — Xtend' }

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

interface Clock {
  type: 'opening' | 'closing'
  created_at: string
  outlet_name: string | null
  distance_m: number | null
  status: string | null
  location_label: string | null
  device_info: { source?: string; reason?: string } | null
}
/** One person, one day: everything Xtend recorded about it, on a single page. */
interface DayReportRow {
  scope?: 'day' | 'store' | null
  store_label?: string | null
  body: string | null
  sales_summary: string | null
  stock_status: string | null
  competitor_activity: string | null
  issues: string | null
}

interface CorrectionRow {
  action: CorrectionAction
  reason: string
  created_at: string
  status: string
  profiles: { full_name: string } | null
}

export default async function DayOverview({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession(['admin', 'supervisor', 'hr'])
  const q = await searchParams
  const id = one(q.person)
  const date = one(q.date)
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const supabase = await createServerSupabase()
  const { data: person } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, is_active, supervisor_id, outlet_id')
    .eq('id', id)
    .maybeSingle<{
      id: string
      full_name: string
      phone: string | null
      role: string
      is_active: boolean
      supervisor_id: string | null
      outlet_id: string | null
    }>()
  if (!person) notFound()

  const [clocks, visits, report, flags, alerts, pings] = await Promise.all([
    supabase
      .from('attendance')
      .select('type, created_at, outlet_name, distance_m, status, location_label, device_info')
      .eq('user_id', id)
      .eq('attendance_date', date)
      .order('created_at')
      .returns<Clock[]>(),
    // Every check-in and check-out, with both photos (0091).
    supabase
      .from('store_visit_detail')
      .select('*')
      .eq('user_id', id)
      .eq('visit_date', date)
      .order('arrived_at')
      .returns<VisitRow[]>(),
    supabase
      .from('reports')
      // Every report of the day (0088: the whole day and each store). The
      // star keeps this working before 0088 adds scope and store_label.
      .select('*')
      .eq('user_id', id)
      .eq('report_date', date)
      .order('created_at')
      .returns<DayReportRow[]>(),
    supabase
      .from('integrity_flags')
      .select('kind, severity, summary')
      .eq('user_id', id)
      .eq('flag_date', date)
      .returns<{ kind: string; severity: string; summary: string }[]>(),
    supabase
      .from('location_alerts')
      .select('alert_type, distance_m, created_at')
      .eq('user_id', id)
      .gte('created_at', `${date}T00:00:00+01:00`)
      .lt('created_at', `${date}T23:59:59+01:00`)
      .order('created_at')
      .returns<{ alert_type: string; distance_m: number | null; created_at: string }[]>(),
    supabase
      .from('location_pings')
      .select('created_at', { count: 'exact' })
      .eq('user_id', id)
      .gte('created_at', `${date}T00:00:00+01:00`)
      .lt('created_at', `${date}T23:59:59+01:00`)
      .order('created_at')
      .limit(1),
  ])

  const opening = clocks.data?.find((c) => c.type === 'opening') ?? null
  const closing = [...(clocks.data ?? [])].reverse().find((c) => c.type === 'closing') ?? null
  const hours = opening && closing ? (Date.parse(closing.created_at) - Date.parse(opening.created_at)) / 3_600_000 : null
  const qs = `person=${id}&date=${date}&until=${date}`
  const visitList = (visits.data ?? []).map(toDayVisit)
  // Visit photos are private: short-lived links, signed here (RLS on storage
  // keeps a supervisor to their own team's photos).
  const signed = await signSelfies(supabase, visitList.flatMap((v) => [v.in_photo, v.out_photo]))
  const visitPhotos: Record<string, string | null> = Object.fromEntries(
    visitList.flatMap((v) => [v.in_photo, v.out_photo]).filter((p): p is string => Boolean(p)).map((p) => [p, signed.get(p) ?? null]),
  )
  // The whole-day report first, then each store's.
  const dayReports = [...(report.data ?? [])]
    .sort((a, b) => Number(a.scope === 'store') - Number(b.scope === 'store'))
    .map((r) => ({
      title: r.scope === 'store' ? (r.store_label ?? 'A store') : 'The whole day',
      fields: ([
        ['Report', r.body],
        ['Sales', r.sales_summary],
        ['Stock', r.stock_status],
        ['Competitors', r.competitor_activity],
        ['Issues', r.issues],
      ] as const).filter(([, v]) => v),
    }))

  // Fixing today's record (0090): today only, for active field staff, by an
  // admin, HR, or their own supervisor. The database checks it again.
  const today = lagosDateString()
  const viewer = session.profile.role
  const canFix =
    date === today &&
    person.is_active &&
    (person.role === 'merchandiser' || person.role === 'marketer') &&
    (viewer === 'admin' || viewer === 'hr' || person.supervisor_id === session.userId)
  const [fixStores, corrections] = canFix
    ? await Promise.all([
        supabase
          .rpc('outlets_for_user', { target: id })
          .then(async ({ data }) => {
            const ids = ((data ?? []) as { outlet_id: string }[]).map((r) => r.outlet_id)
            if (!ids.length) return [] as { id: string; name: string }[]
            const { data: rows } = await supabase
              .from('outlets')
              .select('id, name')
              .in('id', ids)
              .eq('is_active', true)
              .not('lat', 'is', null)
              .order('name')
            return (rows ?? []) as { id: string; name: string }[]
          }),
        supabase
          .from('field_corrections')
          .select('action, reason, created_at, status, profiles!field_corrections_requested_by_fkey(full_name)')
          .eq('user_id', id)
          .eq('correction_date', date)
          .order('created_at')
          .then(({ data }) => (data ?? []) as unknown as CorrectionRow[]),
      ])
    : [[] as { id: string; name: string }[], [] as CorrectionRow[]]

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/attendance?from=${date}&to=${date}`} className="text-xs font-semibold text-brand hover:underline">
          Back to attendance
        </Link>
        <h1 className="text-xl font-semibold">{person.full_name}</h1>
        <p className="text-sm text-muted-foreground">
          {longDate(date)}
          {person.phone && (
            <>
              {' · '}
              <a href={`tel:${person.phone}`} className="font-semibold text-brand hover:underline">
                Call {person.phone}
              </a>
            </>
          )}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="Clocked in" value={opening ? formatLagos(opening.created_at, false) : 'No'} warn={!opening} />
        <Box label="Clocked out" value={closing ? formatLagos(closing.created_at, false) : opening ? 'Not yet' : '—'} />
        <Box label="Hours" value={hours === null ? '—' : `${Math.round(hours * 10) / 10} h`} />
        <Box label="Store visits" value={String(visitList.length)} />
      </section>

      {canFix && (
        <DayCorrections
          personId={id}
          personName={person.full_name}
          date={date}
          marketer={person.role === 'marketer'}
          clockedIn={Boolean(opening)}
          clockedOut={Boolean(closing)}
          stores={fixStores}
          homeStoreId={person.outlet_id}
          visits={visitList.map((v) => ({ id: v.id, name: v.store, status: v.status }))}
        />
      )}
      {corrections.length > 0 && (
        <Block title="Corrections today">
          <ul className="divide-y divide-border text-sm">
            {corrections.map((c, i) => (
              <li key={i} className="py-2">
                <span className="font-semibold">{CORRECTION_LABELS[c.action] ?? c.action}</span>
                {c.status === 'open' && <Badge variant="outline" className="ml-2">Waiting for them</Badge>}
                <span className="block text-xs text-muted-foreground">
                  {formatLagos(c.created_at, false)} · by {c.profiles?.full_name ?? 'the office'} · {c.reason}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Clock records">
        {(clocks.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No clock-in or clock-out on this day.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {clocks.data!.map((c) => (
              <li key={c.created_at + c.type} className="py-2">
                <span className="font-semibold">{c.type === 'opening' ? 'Clock-in' : 'Clock-out'}</span> at{' '}
                {formatLagos(c.created_at, false)}
                {c.device_info?.source === 'office' && (
                  <Badge variant="outline" className="ml-2">
                    By the office
                  </Badge>
                )}
                {c.status && c.status !== 'on_site' && (
                  <Badge variant="destructive" className="ml-2">
                    {c.status === 'flagged' ? 'Flagged' : 'Off site'}
                  </Badge>
                )}
                <span className="block text-xs text-muted-foreground">
                  {c.outlet_name ?? 'No store'}
                  {c.distance_m !== null ? ` · ${metres(c.distance_m)} from it` : ''}
                  {c.location_label ? ` · ${c.location_label}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={`Store check-ins and check-outs (${visitList.length})`}>
        <VisitPhotoList visits={visitList} photos={visitPhotos} name={person.full_name ?? 'They'} />
      </Block>

      <Block title={dayReports.length > 1 ? `Reports (${dayReports.length})` : 'Day report'}>
        {dayReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No report sent for this day.</p>
        ) : (
          <div className="space-y-4">
            {dayReports.map((r, i) => (
              <div key={i} className="space-y-2">
                {(dayReports.length > 1 || r.title !== 'The whole day') && (
                  <p className="text-sm font-semibold">Report for {r.title}</p>
                )}
                <dl className="space-y-2 text-sm">
                  {r.fields.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title="Movement and alerts">
        <p className="text-sm">
          {pings.count ?? 0} position{pings.count === 1 ? '' : 's'} recorded.{' '}
          <Link href={`/admin/tracking?${qs}`} className="font-semibold text-brand hover:underline">
            See the movement
          </Link>
        </p>
        {(alerts.data ?? []).length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
            {alerts.data!.map((a) => (
              <li key={a.created_at}>
                {formatLagos(a.created_at, false)}: {a.alert_type.replaceAll('_', ' ')}
                {a.distance_m !== null ? ` (${metres(a.distance_m)})` : ''}
              </li>
            ))}
          </ul>
        )}
      </Block>

      {(flags.data ?? []).length > 0 && (
        <Alert variant="warning">
          <p className="font-semibold">Flags raised this day</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {flags.data!.map((f, i) => (
              <li key={i}>
                {flagHeadline(f.kind)}: {f.summary}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  )
}

function Box({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${warn ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface p-4 sm:p-5">
      <h2 className="mb-2 text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}
