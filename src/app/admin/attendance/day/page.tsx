import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ChevronRight, Flag, LogIn, LogOut, MapPin, Phone, Store, TriangleAlert } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { flagHeadline } from '@/lib/flag-labels'
import { formatLagos, lagosDateString, longDate, metres } from '@/lib/utils'
import { DayCorrections } from '@/components/admin/day-corrections'
import { ClockOutHoldSwitch } from '@/components/admin/clock-out-hold-switch'
import { clockOutOpensAt } from '@/lib/clock-out-time'
import { toDayVisit } from '@/components/admin/visit-photo-list'
import { DayPhotoGallery, type DayPhoto } from '@/components/admin/day-photo-gallery'
import { isPhotoFlagReason, type PhotoFlagReason } from '@/lib/photo-flags'
import { avatarUrls } from '@/lib/avatars'
import { addDays, cn } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'
import { signSelfies } from '@/lib/export/data'
import type { VisitRow } from '@/lib/visit-review'
import { CORRECTION_LABELS, type CorrectionAction } from '@/lib/field-corrections'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Day overview — Xtend' }

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

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

type FixStore = { id: string; name: string; lat: number | null; lng: number | null; geofence_radius_m: number | null }

export default async function DayOverview({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession(['admin', 'supervisor', 'hr'])
  const q = await searchParams
  const id = one(q.person)
  const date = one(q.date)
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const supabase = await createServerSupabase()
  const { data: person } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, is_active, supervisor_id, outlet_id, avatar_path')
    .eq('id', id)
    .maybeSingle<{
      id: string
      full_name: string
      phone: string | null
      role: string
      is_active: boolean
      supervisor_id: string | null
      outlet_id: string | null
      avatar_path: string | null
    }>()
  if (!person) notFound()

  const [clocks, visits, report, flags, alerts, pings] = await Promise.all([
    // attendance_detail: the place, the distance and the photo paths too.
    supabase
      .from('attendance_detail')
      .select('*')
      .eq('user_id', id)
      .eq('attendance_date', date)
      .order('created_at')
      .returns<AttendanceDetail[]>(),
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
      .select('kind, severity, summary, detail, reviewed_at')
      .eq('user_id', id)
      .eq('flag_date', date)
      .returns<{ kind: string; severity: string; summary: string; detail: Record<string, unknown> | null; reviewed_at: string | null }[]>(),
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
  const clockList = clocks.data ?? []
  const visitRows = visits.data ?? []
  const visitList = visitRows.map(toDayVisit)

  // The office's own photo flags (0092), by photo.
  const photoFlags = new Map<string, { reason: PhotoFlagReason; note: string | null }>()
  for (const f of flags.data ?? []) {
    const path = typeof f.detail?.path === 'string' ? f.detail.path : null
    const reason = f.detail?.reason
    if (f.kind === 'photo_flagged' && path && isPhotoFlagReason(reason)) {
      photoFlags.set(path, { reason, note: typeof f.detail?.note === 'string' ? f.detail.note : null })
    }
  }

  // Every photo of the day, in time order, full size. Private: short-lived
  // links signed here (storage keeps a supervisor to their own team's).
  const storeName = (v: VisitRow) => v.store_label ?? v.outlet_name ?? 'A place'
  const photos: DayPhoto[] = [
    ...clockList.map((c) => ({
      path: c.selfie_path,
      url: null,
      event: (c.type === 'opening' ? 'clock_in' : 'clock_out') as DayPhoto['event'],
      at: c.created_at,
      store: c.outlet_name,
      where: c.location_label,
      distance_m: c.distance_m,
      radius_m: c.outlet_radius_m,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      byOffice: (c.device_info as { source?: string } | null)?.source === 'office',
      flag: c.selfie_path ? (photoFlags.get(c.selfie_path) ?? null) : null,
    })),
    ...visitRows.flatMap((v) => [
      {
        path: v.selfie_path,
        url: null,
        event: 'check_in' as const,
        at: v.arrived_at,
        store: storeName(v),
        where: v.arrived_label,
        distance_m: v.arrived_distance_m,
        radius_m: v.outlet_radius_m ?? null,
        status: v.arrived_status,
        lat: v.arrived_lat ?? null,
        lng: v.arrived_lng ?? null,
        flag: v.selfie_path ? (photoFlags.get(v.selfie_path) ?? null) : null,
      },
      ...(v.departed_at
        ? [
            {
              path: v.departed_selfie_path ?? null,
              url: null,
              event: 'check_out' as const,
              at: v.departed_at,
              store: storeName(v),
              where: v.departed_label ?? null,
              distance_m: v.departed_distance_m,
              radius_m: v.outlet_radius_m ?? null,
              status: v.departed_status,
              lat: v.departed_lat ?? null,
              lng: v.departed_lng ?? null,
              flag: v.departed_selfie_path ? (photoFlags.get(v.departed_selfie_path) ?? null) : null,
            },
          ]
        : []),
    ]),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const [signed, avatars] = await Promise.all([
    signSelfies(supabase, photos.map((p) => p.path)),
    avatarUrls(supabase, person.avatar_path ? [person.id] : []),
  ])
  for (const p of photos) p.url = p.path ? (signed.get(p.path) ?? null) : null
  const avatar = avatars.get(person.id) ?? null
  const flaggedPhotos = photos.filter((p) => p.flag).length

  // Who reports to whom and their home store, for the header.
  const [{ data: sup }, { data: home }] = await Promise.all([
    person.supervisor_id
      ? supabase.from('profiles').select('full_name').eq('id', person.supervisor_id).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    person.outlet_id
      ? supabase.from('outlets').select('name').eq('id', person.outlet_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
  ])

  // The day, in order: clock events, store visits and location alerts.
  const timeline = [
    ...clockList.map((c) => ({
      at: c.created_at,
      icon: c.type === 'opening' ? 'in' : 'out',
      text: `${c.type === 'opening' ? 'Clocked in' : 'Clocked out'}${c.outlet_name ? ` · ${c.outlet_name}` : ''}`,
      note: c.distance_m != null ? `${metres(c.distance_m)} from the store` : c.location_label,
      bad: Boolean(c.status && c.status !== 'on_site'),
    })),
    ...visitRows.flatMap((v) => [
      {
        at: v.arrived_at,
        icon: 'store',
        text: `Checked in at ${storeName(v)}`,
        note: v.arrived_distance_m != null ? `${metres(v.arrived_distance_m)} from the store` : v.arrived_label,
        bad: Boolean(v.arrived_status && v.arrived_status !== 'on_site'),
      },
      ...(v.departed_at
        ? [
            {
              at: v.departed_at,
              icon: 'store',
              text: `Checked out of ${storeName(v)} after ${v.minutes} min`,
              note: v.departed_distance_m != null ? `${metres(v.departed_distance_m)} from the store` : (v.departed_label ?? null),
              bad: Boolean(v.departed_status && v.departed_status !== 'on_site'),
            },
          ]
        : []),
    ]),
    ...(alerts.data ?? []).map((a) => ({
      at: a.created_at,
      icon: 'alert',
      text: a.alert_type.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase()),
      note: a.distance_m !== null ? metres(a.distance_m) : null,
      bad: true,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
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
  // The clock-out hold (0111): any day's page, for the same people. Read
  // with * so the page still works before 0111 adds the column.
  const canHold =
    person.is_active &&
    (person.role === 'merchandiser' || person.role === 'marketer') &&
    (viewer === 'admin' || viewer === 'hr' || person.supervisor_id === session.userId)
  const { data: holdRow } = canHold
    ? await supabase.from('profiles').select('*').eq('id', id).maybeSingle<{
        hold_clock_out?: boolean
        shift_end?: string | null
        clock_out_from?: string | null
      }>()
    : { data: null }
  const holdState = typeof holdRow?.hold_clock_out === 'boolean' ? holdRow.hold_clock_out : null
  // Where their phone last reported today (0112): the office can record them there.
  const { data: lastPing } = canFix
    ? await supabase
        .from('location_pings')
        .select('lat, lng, accuracy_m, created_at')
        .eq('user_id', id)
        .gte('created_at', `${date}T00:00:00+01:00`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ lat: number; lng: number; accuracy_m: number; created_at: string }>()
    : { data: null }
  const [fixStores, corrections] = canFix
    ? await Promise.all([
        supabase
          .rpc('outlets_for_user', { target: id })
          .then(async ({ data }) => {
            const ids = ((data ?? []) as { outlet_id: string }[]).map((r) => r.outlet_id)
            if (!ids.length) return [] as FixStore[]
            const { data: rows } = await supabase
              .from('outlets')
              .select('id, name, lat, lng, geofence_radius_m')
              .in('id', ids)
              .eq('is_active', true)
              .not('lat', 'is', null)
              .order('name')
            return (rows ?? []) as FixStore[]
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

  const canFlag = viewer === 'admin' || (viewer === 'supervisor' && person.supervisor_id === session.userId)
  const prev = addDays(date, -1)
  const next = addDays(date, 1)
  const dayHref = (d: string) => `/admin/attendance/day?person=${id}&date=${d}`
  const initials = person.full_name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const otherFlags = (flags.data ?? []).filter((f) => f.kind !== 'photo_flagged')

  return (
    <div className="space-y-5">
      <Link href={`/admin/attendance?from=${date}&to=${date}`} className="text-xs font-semibold text-brand hover:underline">
        ← Back to attendance
      </Link>

      {/* Who, and which day. */}
      <header className="surface flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-border" />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-tint text-xl font-extrabold text-brand">
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold">{person.full_name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Badge variant="outline" className="capitalize">
                {person.role}
              </Badge>
              {!person.is_active && <Badge variant="destructive">Inactive</Badge>}
              <span>{home?.name ? `Home store: ${home.name}` : 'No home store'}</span>
              {sup?.full_name && <span>· {sup.full_name}&rsquo;s team</span>}
            </p>
            {person.phone && (
              <a href={`tel:${person.phone}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                <Phone className="h-3.5 w-3.5" /> Call {person.phone}
              </a>
            )}
          </div>
        </div>
        <nav aria-label="Day" className="flex items-center gap-2">
          <Link href={dayHref(prev)} aria-label="The day before" className="flex h-11 w-11 items-center justify-center rounded-xl border border-border hover:bg-tint">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <form method="get" className="flex items-center">
            <input type="hidden" name="person" value={id} />
            <input
              type="date"
              name="date"
              defaultValue={date}
              max={today}
              aria-label="Pick a day"
              className="h-11 rounded-xl border border-input bg-card px-3 text-sm"
            />
            <button type="submit" className="ml-2 h-11 rounded-xl bg-brand px-3 text-sm font-semibold text-primary-foreground">
              Go
            </button>
          </form>
          {next <= today ? (
            <Link href={dayHref(next)} aria-label="The day after" className="flex h-11 w-11 items-center justify-center rounded-xl border border-border hover:bg-tint">
              <ChevronRight className="h-5 w-5" />
            </Link>
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border opacity-40" aria-hidden>
              <ChevronRight className="h-5 w-5" />
            </span>
          )}
        </nav>
      </header>
      <h2 className="text-lg font-bold">
        {longDate(date)}
        {date === today && <span className="ml-2 text-sm font-semibold text-brand">Today</span>}
      </h2>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Box
          label="Clocked in"
          value={opening ? formatLagos(opening.created_at, false) : 'No'}
          note={opening ? (opening.is_late ? 'Late' : 'On time') : undefined}
          warn={!opening || Boolean(opening?.is_late)}
        />
        <Box label="Clocked out" value={closing ? formatLagos(closing.created_at, false) : opening ? 'Not yet' : '—'} />
        <Box label="Hours" value={hours === null ? '—' : `${Math.round(hours * 10) / 10} h`} />
        <Box label="Stores visited" value={String(visitList.length)} />
        <Box label="Photos flagged" value={String(flaggedPhotos)} warn={flaggedPhotos > 0} />
      </section>

      {holdState !== null && (
        <ClockOutHoldSwitch
          personId={id}
          personName={person.full_name}
          hold={holdState}
          opensAt={clockOutOpensAt(holdRow?.shift_end ?? null, holdRow?.clock_out_from ?? null)}
        />
      )}

      {canFix && (
        <DayCorrections
          personId={id}
          personName={person.full_name}
          date={date}
          marketer={person.role === 'marketer'}
          clockedIn={Boolean(opening)}
          clockedOut={Boolean(closing)}
          stores={fixStores}
          lastPhone={lastPing ? { lat: lastPing.lat, lng: lastPing.lng, accuracy_m: lastPing.accuracy_m, at: lastPing.created_at } : null}
          homeStoreId={person.outlet_id}
          visits={visitRows.map((v, i) => ({ id: v.id, name: visitList[i].store, status: v.status, storeId: v.outlet_id ?? null }))}
        />
      )}

      <Block
        title={`Photos of the day (${photos.length})`}
        note={
          canFlag
            ? 'Every clock-in, clock-out and store visit photo, with where it was taken. Tap a photo to open it full size; flag one that is not right.'
            : 'Every clock-in, clock-out and store visit photo, with where it was taken. Tap a photo to open it full size.'
        }
      >
        <DayPhotoGallery photos={photos} canFlag={canFlag} />
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="The day, in order">
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded on this day.</p>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-border pl-5">
              {timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span
                    className={cn(
                      'absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card',
                      t.bad ? 'bg-destructive text-white' : 'bg-tint text-brand',
                    )}
                  >
                    {t.icon === 'in' ? (
                      <LogIn className="h-3 w-3" />
                    ) : t.icon === 'out' ? (
                      <LogOut className="h-3 w-3" />
                    ) : t.icon === 'store' ? (
                      <Store className="h-3 w-3" />
                    ) : (
                      <TriangleAlert className="h-3 w-3" />
                    )}
                  </span>
                  <p className="text-sm">
                    <span className="font-semibold tabular-nums">{formatLagos(t.at, false)}</span> {t.text}
                  </p>
                  {t.note && <p className="text-xs text-muted-foreground">{t.note}</p>}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 flex items-center gap-1 text-sm">
            <MapPin className="h-4 w-4 text-brand" />
            {pings.count ?? 0} position{pings.count === 1 ? '' : 's'} recorded.{' '}
            <Link href={`/admin/tracking?${qs}`} className="font-semibold text-brand hover:underline">
              See the movement
            </Link>
          </p>
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
                        <dt className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
                        <dd className="whitespace-pre-wrap break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </Block>
      </div>

      {(otherFlags.length > 0 || flaggedPhotos > 0) && (
        <Block title="Flags raised this day">
          <ul className="space-y-1.5 text-sm">
            {(flags.data ?? []).map((f, i) => (
              <li key={i} className="flex gap-2">
                <Flag className={cn('mt-0.5 h-4 w-4 shrink-0', f.reviewed_at ? 'text-muted-foreground' : 'text-destructive')} />
                <span>
                  <span className="font-semibold">{flagHeadline(f.kind)}</span>: {f.summary}
                  {f.reviewed_at && <span className="text-muted-foreground"> · looked at</span>}
                </span>
              </li>
            ))}
          </ul>
          {viewer !== 'hr' && (
            <Link href={`/admin/integrity?person=${id}&from=${date}&to=${date}&status=all`} className="mt-2 inline-block text-sm font-semibold text-brand hover:underline">
              Open in Integrity
            </Link>
          )}
        </Block>
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
    </div>
  )
}

function Box({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${warn ? 'text-destructive' : ''}`}>{value}</p>
      {note && <p className={`text-xs font-semibold ${warn ? 'text-destructive' : 'text-muted-foreground'}`}>{note}</p>}
    </div>
  )
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="surface p-4 sm:p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {note && <p className="mb-3 mt-0.5 text-sm text-muted-foreground">{note}</p>}
      {!note && <div className="mb-2" />}
      {children}
    </section>
  )
}
