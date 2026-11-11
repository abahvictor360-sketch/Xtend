import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { flagHeadline } from '@/lib/flag-labels'
import { formatLagos, longDate, metres } from '@/lib/utils'

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
}
interface Visit {
  id: string
  status: string
  arrived_at: string | null
  departed_at: string | null
  arrived_distance_m: number | null
  arrived_place_name: string | null
  outlets: { name: string } | null
}

/** One person, one day: everything Xtend recorded about it, on a single page. */
export default async function DayOverview({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor', 'hr'])
  const q = await searchParams
  const id = one(q.person)
  const date = one(q.date)
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const supabase = await createServerSupabase()
  const { data: person } = await supabase
    .from('profiles')
    .select('id, full_name, phone')
    .eq('id', id)
    .maybeSingle<{ id: string; full_name: string; phone: string | null }>()
  if (!person) notFound()

  const [clocks, visits, report, flags, alerts, pings] = await Promise.all([
    supabase
      .from('attendance')
      .select('type, created_at, outlet_name, distance_m, status, location_label')
      .eq('user_id', id)
      .eq('attendance_date', date)
      .order('created_at')
      .returns<Clock[]>(),
    supabase
      .from('store_visits')
      .select('id, status, arrived_at, departed_at, arrived_distance_m, arrived_place_name, outlets(name)')
      .eq('user_id', id)
      .eq('visit_date', date)
      .order('arrived_at')
      .returns<Visit[]>(),
    supabase
      .from('reports')
      .select('body, sales_summary, stock_status, competitor_activity, issues')
      .eq('user_id', id)
      .eq('report_date', date)
      .maybeSingle<{ body: string | null; sales_summary: string | null; stock_status: string | null; competitor_activity: string | null; issues: string | null }>(),
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
  const visitList = visits.data ?? []
  const reportFields = report.data
    ? ([
        ['Report', report.data.body],
        ['Sales', report.data.sales_summary],
        ['Stock', report.data.stock_status],
        ['Competitors', report.data.competitor_activity],
        ['Issues', report.data.issues],
      ] as const).filter(([, v]) => v)
    : []

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

      <Block title="Clock records">
        {(clocks.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No clock-in or clock-out on this day.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {clocks.data!.map((c) => (
              <li key={c.created_at + c.type} className="py-2">
                <span className="font-semibold">{c.type === 'opening' ? 'Clock-in' : 'Clock-out'}</span> at{' '}
                {formatLagos(c.created_at, false)}
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

      <Block title="Store visits">
        {visitList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No store check-ins.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {visitList.map((v) => (
              <li key={v.id} className="py-2">
                <span className="font-semibold">{v.outlets?.name ?? v.arrived_place_name ?? 'A place'}</span>
                <span className="block text-xs text-muted-foreground">
                  In {v.arrived_at ? formatLagos(v.arrived_at, false) : '—'} · out{' '}
                  {v.departed_at ? formatLagos(v.departed_at, false) : v.status === 'open' ? 'still there' : '—'}
                  {v.arrived_distance_m !== null ? ` · ${metres(v.arrived_distance_m)} from the store pin` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Day report">
        {reportFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No report sent for this day.</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {reportFields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap break-words">{value}</dd>
              </div>
            ))}
          </dl>
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
