import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { AutoRefresh, LiveMap, TrailMap } from '@/components/admin/movement-map'
import type { LiveLocation } from '@/components/admin/live-locations'
import { avatarUrls, withAvatars } from '@/lib/avatars'
import {
  GAP_MINUTES,
  KIND_LABEL,
  ROUGH_M,
  duration,
  storeAt,
  summarise,
  type Trail,
} from '@/lib/movement'
import { cn, formatLagos, lagosDateString, metres } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Movement — Xtend' }

interface Search {
  person?: string
  date?: string
}

export default async function TrackingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const supabase = await createServerSupabase()
  const today = lagosDateString()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.date ?? '') ? search.date! : today

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
  let problem: string | null = null
  if (person) {
    const { data, error } = await supabase.rpc('movement_trail', {
      p_user: person.id,
      p_date: date,
    })
    if (error) {
      problem =
        error.code === 'PGRST202' || error.code === '42883'
          ? 'This needs the movement update (028) run in Supabase.'
          : error.message
    } else {
      trail = data as Trail
    }
  }
  const summary = trail ? summarise(trail) : null

  return (
    <div className="space-y-5">
      {date === today && <AutoRefresh seconds={60} />}

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Movement</h1>
        <p className="text-sm text-muted-foreground">
          Where staff are and where they have been since clocking in. While someone is on shift, the
          app sends their position every 5 minutes (with no network, the phone keeps it and sends it
          when the connection is back); Xtend also records every clock-in, store check-in and
          check-out. {date === today && 'Updates every minute.'}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="w-full space-y-1.5 sm:w-60">
          <Label htmlFor="person">Follow</Label>
          <Select
            id="person"
            name="person"
            defaultValue={person?.id ?? ''}
            className="h-10 text-sm"
          >
            <option value="">Everyone on shift (live)</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="date">Day</Label>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={date}
            max={today}
            className="h-10 w-40"
          />
        </div>
        <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
          Show
        </button>
      </form>

      {problem && <Alert variant="destructive">{problem}</Alert>}

      {!person && (
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
                        href={`/admin/tracking?person=${r.user_id}`}
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

      {person && trail && summary && (
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
                {personPhoto ? 'Profile photo' : 'No profile photo yet'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Figure
              label="Clocked in"
              value={summary.clockedIn ? formatLagos(summary.clockedIn, false) : '—'}
            />
            <Figure
              label={summary.clockedOut ? 'Clocked out' : 'Last seen'}
              value={formatLagos(summary.clockedOut ?? summary.lastAt, false)}
            />
            <Figure label="Distance moved" value={metres(summary.distanceM)} />
            <Figure
              label="Outside their stores"
              value={summary.outsideMinutes ? duration(summary.outsideMinutes) : 'None'}
              warn={summary.outsideMinutes >= 30}
            />
            <Figure
              label="Longest silence"
              value={summary.longestGap ? duration(summary.longestGap.minutes) : 'None'}
              warn={Boolean(summary.longestGap && summary.longestGap.minutes >= 60)}
            />
          </div>

          {trail.points.length === 0 ? (
            <Alert variant="info">
              Nothing recorded for {person.full_name} on this day: no clock-in and no positions.
            </Alert>
          ) : (
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <TrailMap trail={trail} />
                <Legend trail />
              </div>
              <div className="surface p-5">
                <h2 className="text-lg font-bold">{person.full_name}&apos;s day</h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  {summary.positions} position{summary.positions === 1 ? '' : 's'}, in time order
                </p>
                <ol className="max-h-[480px] space-y-0.5 overflow-y-auto pr-1 text-sm">
                  {trail.points.map((p, i) => {
                    const prev = trail.points[i - 1]
                    const gap = prev
                      ? (new Date(p.at).getTime() - new Date(prev.at).getTime()) / 60000
                      : 0
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
                            className={cn(
                              'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                              inside ? 'bg-[#d1511a]' : 'bg-[#8a3a12]',
                            )}
                            aria-label={inside ? 'In a store' : 'Outside every store'}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ol>
                <Link
                  href={`/admin/excuses?person=${person.id}&date=${date}`}
                  className="mt-4 block text-sm font-semibold text-brand hover:underline"
                >
                  Check an excuse for a silence →
                </Link>
              </div>
            </div>
          )}
        </>
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
