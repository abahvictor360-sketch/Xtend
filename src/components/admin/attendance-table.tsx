'use client'

import { Fragment, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronDown, Map as MapIcon, Phone, Table as TableIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AttendanceMap } from '@/components/admin/attendance-map'
import {
  clock,
  deviceText,
  hoursText,
  lateness,
  minutesOf,
  sortDays,
  type DayRecord,
  type SortKey,
} from '@/lib/attendance-report'
import { cn, formatLagos, metres } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'

export interface TablePerson {
  name: string
  phone: string | null
  store: string | null
  team: string | null
  role: string
}

type Row = DayRecord<AttendanceDetail>

const PAGE = 100
/** A clock event that reached the server this long after the phone took it was saved offline. */
const OFFLINE_MIN = 5

/**
 * A row per person per day: clock-in and clock-out side by side, how it
 * went, and everything recorded about it when opened. Columns sort with a
 * tap; the map shows the same clock events as pins.
 */
export function AttendanceTable({
  rows,
  people,
  total,
}: {
  rows: Row[]
  people: Record<string, TablePerson>
  /** Days matching before the list was cut, when it was. */
  total: number
}) {
  const [view, setView] = useState<'table' | 'map'>('table')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [limit, setLimit] = useState(PAGE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Record<string, string | null>>({})

  const names = useMemo(() => new Map(Object.entries(people).map(([id, p]) => [id, p.name])), [people])
  const sorted = useMemo(() => sortDays(rows, names, sort.key, sort.dir), [rows, names, sort])
  const events = useMemo(
    () => rows.flatMap((r) => [r.clockIn, r.clockOut].filter((e): e is AttendanceDetail => Boolean(e))),
    [rows],
  )

  /** Buckets are private; photos are fetched as short-lived links only when a day is opened. */
  const open = useCallback(
    async (row: Row) => {
      if (expanded === row.key) {
        setExpanded(null)
        return
      }
      setExpanded(row.key)
      const paths = [row.clockIn, row.clockOut]
        .map((e) => e?.thumb_path ?? e?.selfie_path)
        .filter((p): p is string => Boolean(p) && !(p! in photos))
      if (!paths.length) return
      try {
        const res = await fetch('/api/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: 'selfies', paths, expires_in: 300 }),
        })
        const { urls } = (await res.json()) as { urls?: Record<string, string> }
        setPhotos((current) => ({ ...current, ...Object.fromEntries(paths.map((p) => [p, urls?.[p] ?? null])) }))
      } catch {
        setPhotos((current) => ({ ...current, ...Object.fromEntries(paths.map((p) => [p, null])) }))
      }
    },
    [expanded, photos],
  )

  const sortBy = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'store' ? 'asc' : 'desc' }))

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nothing matches these filters.
      </p>
    )
  }

  const head = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <button type="button" onClick={() => sortBy(key)} className="inline-flex items-center gap-1 font-semibold hover:text-foreground">
        {label}
        {sort.key === key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  )
  const visible = sorted.slice(0, limit)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Button size="sm" variant={view === 'table' ? 'default' : 'outline'} onClick={() => setView('table')}>
            <TableIcon className="h-4 w-4" /> Table
          </Button>
          <Button size="sm" variant={view === 'map' ? 'default' : 'outline'} onClick={() => setView('map')}>
            <MapIcon className="h-4 w-4" /> Map
          </Button>
        </div>
        {/* On a phone the table is cards, so the sort is a picker. */}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground md:hidden">
          Sort
          <select
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground"
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc']
              setSort({ key, dir })
            }}
          >
            <option value="date:desc">Newest day</option>
            <option value="date:asc">Oldest day</option>
            <option value="name:asc">Name</option>
            <option value="in:asc">Earliest in</option>
            <option value="late:desc">Most late</option>
            <option value="distance:desc">Furthest from store</option>
            <option value="hours:asc">Shortest day</option>
          </select>
        </label>
        {total > rows.length && (
          <p className="w-full text-xs text-muted-foreground">
            The newest {rows.length} of {total} days are listed here. The download has them all.
          </p>
        )}
      </div>

      {view === 'map' ? (
        <AttendanceMap rows={events} />
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {visible.map((row) => {
              const p = people[row.userId]
              return (
                <div key={row.key} className="surface p-3">
                  <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => void open(row)}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">{p?.name ?? 'Someone'}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{shortDate(row.date)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {row.present
                          ? `In ${clock(row.inMinutes)} · ${row.clockOut ? `out ${clock(minutesOf(row.clockOut.local_time))}` : row.onShift ? 'on shift' : 'no clock-out'}${row.hours !== null ? ` · ${hoursText(row.hours)}` : ''}`
                          : 'No clock-in'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.outletName ?? 'No store'}
                        {row.clockIn ? ` · ${metres(row.clockIn.distance_m)} from it` : ''}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        <StatusBadges row={row} />
                      </span>
                    </span>
                    <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 transition-transform', expanded === row.key && 'rotate-180')} />
                  </button>
                  {expanded === row.key && (
                    <div className="mt-3 border-t border-border pt-3">
                      <DayDetail row={row} person={p} photos={photos} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="hidden rounded-lg border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {head('date', 'Day')}
                  {head('name', 'Person')}
                  {head('store', 'Store')}
                  {head('in', 'In')}
                  {head('out', 'Out')}
                  {head('hours', 'Hours')}
                  {head('distance', 'From store')}
                  {head('late', 'How it went')}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const p = people[row.userId]
                  return (
                    <Fragment key={row.key}>
                      <TableRow className="cursor-pointer" onClick={() => void open(row)}>
                        <TableCell className="whitespace-nowrap tabular-nums">{shortDate(row.date)}</TableCell>
                        <TableCell className="font-medium">
                          {p?.name ?? 'Someone'}
                          {p?.team && <span className="block text-xs font-normal text-muted-foreground">{p.team}</span>}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate">{row.outletName ?? '—'}</TableCell>
                        <TableCell className="tabular-nums">{row.present ? clock(row.inMinutes) : '—'}</TableCell>
                        <TableCell className="tabular-nums">
                          {row.clockOut ? clock(minutesOf(row.clockOut.local_time)) : row.onShift ? <span className="text-xs text-muted-foreground">on shift</span> : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{hoursText(row.hours)}</TableCell>
                        <TableCell className="tabular-nums">{row.clockIn ? metres(row.clockIn.distance_m) : '—'}</TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            <StatusBadges row={row} />
                          </span>
                        </TableCell>
                        <TableCell>
                          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded === row.key && 'rotate-180')} />
                        </TableCell>
                      </TableRow>
                      {expanded === row.key && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={9}>
                            <DayDetail row={row} person={p} photos={photos} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {sorted.length > limit && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({sorted.length - limit} left)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function shortDate(d: string) {
  return new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T12:00:00Z`),
  )
}

function StatusBadges({ row }: { row: Row }) {
  if (!row.present) {
    return row.clockOut ? (
      <Badge variant="destructive">Clock-out only</Badge>
    ) : (
      <Badge variant="destructive">Absent</Badge>
    )
  }
  return (
    <>
      {row.late ? (
        <Badge variant="warning">Late{row.minutesLate ? ` ${lateness(row.minutesLate)}` : ''}</Badge>
      ) : (
        <Badge variant="success">On time</Badge>
      )}
      {row.flagged ? <Badge variant="destructive">Flagged</Badge> : row.offSite && <Badge variant="destructive">Off site</Badge>}
      {row.missingOut && <Badge variant="warning">No clock-out</Badge>}
      {row.onShift && <Badge variant="outline">On shift</Badge>}
      {(row.sentLateMin ?? 0) >= OFFLINE_MIN && <Badge variant="outline">Sent {lateness(row.sentLateMin!)} later</Badge>}
    </>
  )
}

/** Links that open the other pages on this person and day. */
function dayLinks(row: Row) {
  const id = row.userId
  const inAt = row.clockIn ? clock(row.inMinutes) : null
  const outAt = row.clockOut ? clock(minutesOf(row.clockOut.local_time)) : null
  // An excuse is usually about the morning: from two hours before the shift to the clock-in.
  const shift = minutesOf(row.clockIn?.shift_start ?? null) ?? 8 * 60
  const from = clock(Math.max(0, shift - 120))
  const to = row.late && inAt ? inAt : outAt ?? '18:00'
  return {
    movement: `/admin/tracking?person=${id}&date=${row.date}&until=${row.date}`,
    excuse: `/admin/excuses?person=${id}&date=${row.date}&until=${row.date}&from=${from}&to=${to}`,
    metrics: `/admin/metrics/staff/${id}`,
  }
}

function DayDetail({ row, person, photos }: { row: Row; person?: TablePerson; photos: Record<string, string | null> }) {
  const links = dayLinks(row)
  return (
    <div className="space-y-3 py-1">
      <div className="grid gap-4 lg:grid-cols-2">
        <EventDetail title="Clock-in" event={row.clockIn} photos={photos} empty="No clock-in recorded on this day." />
        <EventDetail
          title="Clock-out"
          event={row.clockOut}
          photos={photos}
          empty={row.onShift ? 'Still on shift: no clock-out yet.' : row.present ? 'They never clocked out.' : '—'}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2 text-sm">
        <span className="text-xs text-muted-foreground">
          {person?.role ?? 'Staff'}
          {person?.store ? ` · own store ${person.store}` : ''}
          {person?.team ? ` · ${person.team}` : ''}
        </span>
        {person?.phone && (
          <a href={`tel:${person.phone}`} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
            <Phone className="h-3.5 w-3.5" /> Call {person.phone}
          </a>
        )}
        <Link href={links.movement} className="font-semibold text-brand hover:underline">
          Movement that day
        </Link>
        <Link href={links.excuse} className="font-semibold text-brand hover:underline">
          Check an excuse
        </Link>
        <Link href={links.metrics} className="font-semibold text-brand hover:underline">
          X Metrics
        </Link>
      </div>
    </div>
  )
}

function EventDetail({
  title,
  event,
  photos,
  empty,
}: {
  title: string
  event: AttendanceDetail | null
  photos: Record<string, string | null>
  empty: string
}) {
  if (!event) {
    return (
      <div className="rounded-xl border border-dashed border-border p-3 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground">{empty}</p>
      </div>
    )
  }
  const path = event.thumb_path ?? event.selfie_path
  const photo = path ? photos[path] : null
  const loading = Boolean(path) && !(path! in photos)
  const sentLate = Math.round((Date.parse(event.created_at) - Date.parse(event.client_captured_at)) / 60_000)
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3">
      <div className="w-20 shrink-0 sm:w-24">
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={`${title} photo`} className="w-full rounded-lg border border-border" />
        ) : (
          <p className="text-[11px] leading-snug text-muted-foreground">Photo deleted. Clock photos are kept for 24 hours.</p>
        )}
      </div>
      <dl className="grid min-w-0 flex-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold">
            {title} at {formatLagos(event.created_at, false)}
            {event.status && event.status !== 'on_site' && (
              <span className="ml-1 text-destructive">{event.status === 'flagged' ? '· flagged' : '· off site'}</span>
            )}
          </dt>
        </div>
        <Fact label="Where" value={event.location_label} wide />
        <Fact
          label="Map"
          value={
            <a
              href={`https://www.google.com/maps?q=${event.lat},${event.lng}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand hover:underline"
            >
              Open in Google Maps
            </a>
          }
        />
        <Fact label="Store" value={event.outlet_name ?? 'None'} />
        <Fact
          label="From the store"
          value={`${metres(event.distance_m)}${event.outlet_radius_m ? ` (allowed ${event.outlet_radius_m} m)` : ''}`}
        />
        <Fact label="GPS accuracy" value={`±${Math.round(event.accuracy_m)} m`} />
        <Fact label="Taken on the phone" value={formatLagos(event.client_captured_at)} />
        <Fact
          label="Reached Xtend"
          value={`${formatLagos(event.created_at)}${sentLate >= OFFLINE_MIN ? ` · saved offline, sent ${lateness(sentLate)} later` : ''}`}
        />
        <Fact label="Phone" value={deviceText(event.device_info)} wide />
      </dl>
    </div>
  )
}

function Fact({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  )
}
