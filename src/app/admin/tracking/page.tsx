import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { AutoRefresh, LiveMap, TrailMap } from '@/components/admin/movement-map'
import { JourneyKey, JourneyStrip, LEG_COLOUR, legTitle } from '@/components/admin/journey-strip'
import type { LiveLocation } from '@/components/admin/live-locations'
import { avatarUrls, withAvatars } from '@/lib/avatars'
import {
  GAP_MINUTES,
  KIND_LABEL,
  ROUGH_M,
  JUMP_KMH,
  duration,
  journey,
  mergeTrails,
  storeAt,
  summarise,
  type Leg,
  type Trail,
} from '@/lib/movement'
import { MAX_DAYS, daysBetween, fetchTrails } from '@/lib/movement-server'
import { addDays, cn, formatLagos, lagosDateString, longDate, metres } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Movement — Xtend' }

interface Search {
  person?: string
  date?: string
  until?: string
}

export default async function TrackingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const supabase = await createServerSupabase()
  const today = lagosDateString()
  const isDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '')
  const date = isDate(search.date) && search.date! <= today ? search.date! : today
  const until =
    isDate(search.until) && search.until! >= date && search.until! <= today
      ? search.until! <= addDays(date, MAX_DAYS - 1)
        ? search.until!
        : addDays(date, MAX_DAYS - 1)
      : date
  const days = daysBetween(date, until)

  const [{ data: people }, { data: live }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name')
      .in('role', ['merchandiser', 'marketer'])
      .eq('is_active', true)
      .order('full_name'),
    supabase.rpc('live_locations'),
  ])
  const onShift = await withAvatars(supabase, (live ?? []) as LiveLocation[])
  const person = (people ?? []).find((p) => p.id === search.person) ?? null
  const personPhoto = person ? ((await avatarUrls(supabase, [person.id])).get(person.id) ?? null) : null

  let trail: Trail | null = null
  let trails: Trail[] = []
  let problem: string | null = null
  if (person) {
    const got = await fetchTrails(supabase, person.id, days)
    problem = got.error
    trails = got.trails
    if (!problem) trail = mergeTrails(trails)
  }
  const summary = trail ? summarise(trail) : null
  const trip = trail ? journey(trail) : null
  const stops = trip ? trip.legs.filter((l) => l.kind === 'stop') : []
  const longSilences = trip ? trip.legs.filter((l) => l.kind === 'gap' && l.minutes >= 60) : []
  const range = (from: string, to: string) => `?person=${person?.id ?? ''}&date=${from}&until=${to}`
  const presets = [
    { label: 'Today', href: range(today, today) },
    { label: 'Yesterday', href: range(addDays(today, -1), addDays(today, -1)) },
    { label: 'Last 3 days', href: range(addDays(today, -2), today) },
    { label: 'Last 7 days', href: range(addDays(today, -6), today) },
  ]
  const exportQuery = `person=${person?.id ?? ''}&date=${date}&until=${until}`
  const liveView = !person
  const inStore = onShift.filter((r) => r.inside_geofence).length
  const away = onShift.filter((r) => r.inside_geofence === false).length
  const quiet = onShift.filter((r) => (r.minutes_since_ping ?? 999) > 15).length

  return (
    <div className="space-y-5">
      {until === today && <AutoRefresh seconds={60} />}

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Movement</h1>
        <p className="text-sm text-muted-foreground">
          Where staff are and where they have been since clocking in. While someone is on shift, the
          app sends their position every 5 minutes (with no network, the phone keeps it and sends it
          when the connection is back); Xtend also records every clock-in, store check-in and
          check-out. Pick a person to see their journey over up to {MAX_DAYS} days: where they stayed,
          how they travelled and when nothing was heard. {until === today && 'Updates every minute.'}
        </p>
      </div>

      <form className="space-y-3" method="get">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-60">
            <Label htmlFor="person">Follow</Label>
            <Select id="person" name="person" defaultValue={person?.id ?? ''} className="h-10 text-sm">
              <option value="">Everyone on shift (live)</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">From day</Label>
            <Input id="date" name="date" type="date" defaultValue={date} max={today} className="h-10 w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="until">To day</Label>
            <Input id="until" name="until" type="date" defaultValue={until} max={today} className="h-10 w-40" />
          </div>
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Show
          </button>
        </div>
        {person && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
            {presets.map((p) => (
              <Link key={p.label} href={p.href} className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint">
                {p.label}
              </Link>
            ))}
            <span className="text-muted-foreground">· up to {MAX_DAYS} days</span>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-muted-foreground">Download the journey:</span>
              {(['xlsx', 'pdf', 'docx', 'csv'] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/admin/export/movement/${f}?${exportQuery}`}
                  className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
                >
                  {{ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' }[f]}
                </a>
              ))}
            </span>
          </div>
        )}
      </form>

      {problem && <Alert variant="destructive">{problem}</Alert>}

      {liveView && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label="On shift" value={String(onShift.length)} />
          <Figure label="In a store" value={String(inStore)} />
          <Figure label="Away from their store" value={String(away)} warn={away > 0} />
          <Figure label="Not heard in 15+ min" value={String(quiet)} warn={quiet > 0} />
        </div>
      )}

      {liveView && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <LiveMap rows={onShift} />
            <Legend />
          </div>
          <div className="surface p-5">
            <h2 className="text-lg font-bold">On shift now ({onShift.length})</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Tap a name to see their route today.
            </p>
            {onShift.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is on shift right now.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {onShift.map((r) => {
                  const stale = (r.minutes_since_ping ?? 999) > 15
                  return (
                    <li key={r.user_id}>
                      <Link
                        href={`/admin/tracking?person=${r.user_id}&date=${today}`}
                        className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-tint"
                      >
                        <span
                          className={cn(
                            'h-2.5 w-2.5 shrink-0 rounded-full',
                            stale
                              ? 'bg-muted-foreground'
                              : r.inside_geofence === false
                                ? 'bg-[#8a3a12]'
                                : 'bg-[#d1511a]',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{r.full_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.last_place_name ?? r.outlet_name ?? 'No position yet'}
                            {r.minutes_since_ping != null && ` · ${r.minutes_since_ping} min ago`}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold">
                          {r.inside_geofence === false
                            ? `${metres(r.distance_from_outlet_m)} away`
                            : r.inside_geofence
                              ? 'In store'
                              : ''}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {person && trail && summary && trip && (
        <>
          <div className="flex items-center gap-3">
            {personPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={personPhoto}
                alt={`Photo of ${person.full_name}`}
                className="h-14 w-14 rounded-2xl object-cover ring-2 ring-brand/30"
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-sm font-bold text-tint-foreground">
                {person.full_name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w: string) => w[0]?.toUpperCase())
                  .join('')}
              </span>
            )}
            <div>
              <p className="text-lg font-bold leading-tight">{person.full_name}</p>
              <p className="text-xs text-muted-foreground">
                {days.length === 1 ? longDate(date) : `${longDate(date)} to ${longDate(until)} · ${days.length} days`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
            <Figure
              label={days.length === 1 ? 'Clocked in' : 'First clock-in'}
              value={summary.clockedIn ? formatLagos(summary.clockedIn, days.length > 1) : '—'}
            />
            <Figure
              label={summary.clockedOut ? (days.length === 1 ? 'Clocked out' : 'Last clock-out') : 'Last seen'}
              value={summary.lastAt ? formatLagos(trail.points.findLast((p) => p.kind === 'clock_out')?.at ?? summary.lastAt, days.length > 1) : '—'}
            />
            <Figure label="Distance moved" value={metres(summary.distanceM)} />
            <Figure label="At their stores" value={trip.totals.storeMinutes ? duration(trip.totals.storeMinutes) : 'None'} />
            <Figure
              label="Stayed elsewhere"
              value={trip.totals.elsewhereMinutes ? duration(trip.totals.elsewhereMinutes) : 'None'}
              warn={trip.totals.elsewhereMinutes >= 60}
            />
            <Figure label="Travelling" value={trip.totals.movingMinutes ? duration(trip.totals.movingMinutes) : 'None'} />
            <Figure
              label="Nothing heard"
              value={trip.totals.silentMinutes ? duration(trip.totals.silentMinutes) : 'None'}
              warn={Boolean(summary.longestGap && summary.longestGap.minutes >= 60)}
            />
            <Figure label="Stops" value={`${stops.length}${trip.stores.length ? ` · ${trip.stores.length} store${trip.stores.length === 1 ? '' : 's'}` : ''}`} />
          </div>

          {(trip.jumps.length > 0 || longSilences.length > 0 || trip.totals.elsewhereMinutes >= 60) && (
            <Alert variant="destructive">
              <p className="font-semibold">Worth a look</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {trip.jumps.map((j, i) => (
                  <li key={`j${i}`}>
                    {formatLagos(j.from, days.length > 1)}: moved {metres(j.distanceM)} in{' '}
                    {duration(Math.max(1, (Date.parse(j.to) - Date.parse(j.from)) / 60000))}
                    {j.fromPlace || j.toPlace ? ` (${j.fromPlace ?? 'somewhere'} to ${j.toPlace ?? 'somewhere'})` : ''}, over{' '}
                    {JUMP_KMH} km/h. A fake-location app, or a borrowed phone, can do this; a person cannot.
                  </li>
                ))}
                {longSilences.map((g, i) => (
                  <li key={`g${i}`}>
                    Nothing heard for {duration(g.minutes)} from {formatLagos(g.from, days.length > 1)}.{' '}
                    <Link
                      href={`/admin/excuses?person=${person.id}&date=${lagosDateString(new Date(g.from))}&from=${formatLagos(g.from, false)}&until=${lagosDateString(new Date(g.to))}&to=${formatLagos(g.to, false)}`}
                      className="font-semibold underline"
                    >
                      Check an excuse for it
                    </Link>
                  </li>
                ))}
                {trip.totals.elsewhereMinutes >= 60 && (
                  <li>
                    {duration(trip.totals.elsewhereMinutes)} spent staying somewhere other than their stores
                    {stops.filter((l) => l.kind === 'stop' && !l.inStore).length
                      ? `: ${[...new Set(stops.filter((l) => l.kind === 'stop' && !l.inStore).map((l) => (l as Extract<Leg, { kind: 'stop' }>).name))].slice(0, 4).join(', ')}`
                      : ''}
                    .
                  </li>
                )}
              </ul>
            </Alert>
          )}

          {trail.points.length === 0 ? (
            <Alert variant="info">
              Nothing recorded for {person.full_name} {days.length === 1 ? 'on this day' : 'on these days'}: no clock-in and no positions.
            </Alert>
          ) : (
            <>
              <div className="surface space-y-3 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold">Day by day</h2>
                  <JourneyKey />
                </div>
                {days.map((d) => (
                  <JourneyStrip key={d} date={d} legs={trip.legs} />
                ))}
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <TrailMap trail={trail} />
                  <Legend trail />
                </div>
                <div className="surface p-5">
                  <h2 className="text-lg font-bold">Journey</h2>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {stops.length} stop{stops.length === 1 ? '' : 's'} from {summary.positions} reading
                    {summary.positions === 1 ? '' : 's'}. Readings rougher than {ROUGH_M} m are left out.
                  </p>
                  <ol className="max-h-[520px] space-y-1 overflow-y-auto pr-1 text-sm">
                    {trip.legs.map((l, i) => {
                      const prev = trip.legs[i - 1]
                      const newDay = days.length > 1 && (!prev || lagosDateString(new Date(prev.from)) !== lagosDateString(new Date(l.from)))
                      return (
                        <li key={`${l.from}-${i}`}>
                          {newDay && (
                            <p className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                              {longDate(lagosDateString(new Date(l.from)))}
                            </p>
                          )}
                          <LegRow leg={l} />
                        </li>
                      )
                    })}
                  </ol>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-muted-foreground">Every reading</summary>
                    <ol className="mt-2 max-h-[360px] space-y-0.5 overflow-y-auto pr-1">
                      {trail.points.map((p, i) => {
                        const prev = trail.points[i - 1]
                        const gap = prev ? (new Date(p.at).getTime() - new Date(prev.at).getTime()) / 60000 : 0
                        const inside = storeAt(p, trail.stores)
                        return (
                          <li key={`${p.at}-${i}`}>
                            {gap >= GAP_MINUTES && prev.kind !== 'clock_out' && (
                              <p className="my-1 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                                Nothing heard for {duration(gap)}
                              </p>
                            )}
                            <div className="flex gap-3 rounded-xl px-2 py-1.5">
                              <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                                {formatLagos(p.at, false)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium">{KIND_LABEL[p.kind]}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {p.place ?? (inside ? inside.name : 'Outside every store')}
                                  {(p.accuracy_m ?? 0) > ROUGH_M && ' · rough reading'}
                                </span>
                              </span>
                              <span
                                className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', inside ? 'bg-[#d1511a]' : 'bg-[#8a3a12]')}
                                aria-label={inside ? 'In a store' : 'Outside every store'}
                              />
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </details>
                  <Link
                    href={`/admin/excuses?person=${person.id}&date=${date}&until=${until}`}
                    className="mt-4 block text-sm font-semibold text-brand hover:underline"
                  >
                    Check an excuse for these days →
                  </Link>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function LegRow({ leg }: { leg: Leg }) {
  const colour =
    leg.kind === 'stop' ? (leg.inStore ? LEG_COLOUR.store : LEG_COLOUR.elsewhere) : LEG_COLOUR[leg.kind]
  const what =
    leg.kind === 'stop'
      ? leg.name
      : leg.kind === 'move'
        ? `Travelling ${metres(leg.distanceM)}`
        : leg.kind === 'gap'
          ? 'Nothing heard'
          : 'Clocked out'
  const sub =
    leg.kind === 'stop'
      ? `${leg.inStore ? 'At their store' : 'Outside their stores'} · ${duration(leg.minutes)}`
      : leg.kind === 'move'
        ? `${duration(leg.minutes)}${leg.kmh ? ` · about ${Math.round(leg.kmh)} km/h` : ''}`
        : duration(leg.minutes)
  return (
    <div className="flex gap-3 rounded-xl px-2 py-1.5 hover:bg-tint" title={legTitle(leg)}>
      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
        {formatLagos(leg.from, false)}
      </span>
      <span
        className="mt-1 w-1.5 shrink-0 self-stretch rounded-full"
        style={{
          background:
            leg.kind === 'gap' ? `repeating-linear-gradient(0deg, ${colour} 0 3px, transparent 3px 6px)` : colour,
        }}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate', leg.kind === 'stop' ? 'font-semibold' : 'text-muted-foreground')}>
          {what}
        </span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      {leg.kind === 'stop' && (
        <a
          href={`https://www.google.com/maps?q=${leg.lat},${leg.lng}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 pt-0.5 text-xs font-semibold text-brand hover:underline"
        >
          Map
        </a>
      )}
    </div>
  )
}

function Figure({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold tabular-nums', warn && 'text-destructive')}>
        {value}
      </p>
    </div>
  )
}

function Legend({ trail }: { trail?: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#d1511a]" /> In a store
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#8a3a12]" /> Outside every store
      </span>
      {trail ? (
        <span className="flex items-center gap-1.5">
          <span className="w-5 border-t-2 border-dashed border-[#9a8f88]" /> No position for{' '}
          {GAP_MINUTES}+ min
        </span>
      ) : null}
      {trail ? (
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-[#d1511a] bg-white" /> Saved
          offline, sent later
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#9a8f88]" /> Not heard from in 15+ min
        </span>
      )}
      <span className="flex items-center gap-1.5">Circles are store geofences</span>
    </div>
  )
}
