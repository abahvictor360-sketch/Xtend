import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { duration } from '@/lib/movement'
import {
  FLAG_WORDS,
  GAPS,
  coverageCounts,
  movementHref,
  notVisitedIn,
  storeName,
  type Breakdown,
  type Covered,
  type Finding,
  type VisitFilter,
  type VisitRow,
} from '@/lib/visit-review'
import { cn, formatLagos, lagosDateString, metres } from '@/lib/utils'

/*
 * The pieces of the Store visits page (src/app/admin/visits/page.tsx):
 * the day strip, one visit opened up, the per-store and per-person
 * tables, and store coverage. Server components; links carry the filter.
 */

export const chip = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold transition-all',
    active ? 'bg-brand text-primary-foreground shadow-lift' : 'bg-tint text-tint-foreground hover:brightness-95',
  )

/** In, stores, out: the shape of one person's day, in one line. */
export function DayStrip({
  day,
  stores,
  minutes,
}: {
  day?: {
    clocked_in_at: string | null
    clocked_out_at: string | null
    still_in_store: string | null
  }
  stores: number
  minutes: number
}) {
  const item = (label: string, value: string) => (
    <span key={label} className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </span>
  )
  return (
    <div className="mt-2 flex flex-wrap items-start gap-x-7 gap-y-2">
      {item('Clocked in', day?.clocked_in_at ? formatLagos(day.clocked_in_at, false) : '—')}
      {item('Stores', String(stores))}
      {item('In store', duration(minutes))}
      {item(
        'Clocked out',
        day?.clocked_out_at ? formatLagos(day.clocked_out_at, false) : day?.still_in_store ? 'still out' : '—',
      )}
      {day?.still_in_store && (
        <span className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Now in</span>
          <Badge variant="brand">{day.still_in_store}</Badge>
        </span>
      )}
    </div>
  )
}

export function StatusBadge({ status }: { status: string | null }) {
  if (status === 'on_site') return <Badge variant="success">At the store</Badge>
  if (status === 'off_site') return <Badge variant="destructive">Away from the store</Badge>
  if (status === 'flagged') return <Badge variant="warning">Rough location</Badge>
  return <Badge variant="outline">Shop not on Xtend</Badge>
}

/** One visit, closed: the summary line. Open: arrival and departure in full. */
export function VisitLine({ visit, ranged, flags, selfie }: { visit: VisitRow; ranged: boolean; flags: Finding[]; selfie: string | null }) {
  const arrivedMap = visit.arrived_lat != null ? `https://www.google.com/maps?q=${visit.arrived_lat},${visit.arrived_lng}` : null
  const leftMap = visit.departed_lat != null ? `https://www.google.com/maps?q=${visit.departed_lat},${visit.departed_lng}` : null
  const storeMap = visit.outlet_lat != null ? `https://www.google.com/maps?q=${visit.outlet_lat},${visit.outlet_lng}` : null
  const end = visit.departed_at ?? new Date().toISOString()
  const excuse = new URLSearchParams({
    person: visit.user_id,
    date: lagosDateString(new Date(visit.arrived_at)),
    from: formatLagos(visit.arrived_at, false),
    until: lagosDateString(new Date(end)),
    to: formatLagos(end, false),
    claim: 'at_store',
  })
  return (
    <details className={cn('group rounded-xl border border-border bg-card open:border-brand/40', flags.length > 0 && 'border-destructive/40')}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="w-28 shrink-0 tabular-nums">
          {ranged && <span className="block text-xs text-muted-foreground">{visit.visit_date}</span>}
          {formatLagos(visit.arrived_at, false)}
          {visit.departed_at ? ` – ${formatLagos(visit.departed_at, false)}` : ''}
        </span>
        <span className="min-w-0 flex-1 basis-48">
          <span className="block truncate font-semibold">{storeName(visit)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {visit.store_label_source === 'map'
              ? `named by the map${visit.outlet_name ? ` · nearest of theirs: ${visit.outlet_name}` : ''}`
              : (visit.arrived_label ?? '')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {visit.departed_at ? (
            <span className={cn('text-xs font-semibold tabular-nums', flags.some((f) => f.kind === 'short') && 'text-destructive')}>
              {duration(visit.minutes)}
            </span>
          ) : (
            <Badge variant="brand">Still there · {duration(visit.minutes)}</Badge>
          )}
          <StatusBadge status={visit.arrived_status} />
          {[...new Set(flags.map((f) => f.kind))].map((k) => (
            <Badge key={k} variant="destructive">
              {FLAG_WORDS[k]}
            </Badge>
          ))}
        </span>
      </summary>
      <div className="grid gap-x-6 gap-y-3 border-t border-border px-3 py-3 text-xs sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <p className="font-semibold uppercase tracking-wide text-muted-foreground">Checked in</p>
          <Fact k="Time" v={formatLagos(visit.arrived_at)} />
          <Fact k="Where" v={visit.arrived_label} />
          <Fact
            k="From the store"
            v={visit.arrived_distance_m != null ? `${metres(visit.arrived_distance_m)}${visit.outlet_radius_m ? ` (the store’s fence is ${visit.outlet_radius_m} m)` : ''}` : 'No store of theirs to measure from'}
          />
          <Fact k="Location accurate to" v={visit.arrived_accuracy_m != null ? `±${Math.round(visit.arrived_accuracy_m)} m` : null} />
          {arrivedMap && (
            <a href={arrivedMap} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
              Where they checked in, on the map
            </a>
          )}
        </div>
        <div className="space-y-1">
          <p className="font-semibold uppercase tracking-wide text-muted-foreground">Checked out</p>
          {visit.departed_at ? (
            <>
              <Fact k="Time" v={formatLagos(visit.departed_at)} />
              <Fact k="Where" v={visit.departed_label ?? null} />
              <Fact k="From the store" v={visit.departed_distance_m != null ? metres(visit.departed_distance_m) : null} />
              <Fact k="How they left" v={visit.departed_status === 'on_site' ? 'At the store' : visit.departed_status === 'off_site' ? 'Away from the store' : visit.departed_status === 'flagged' ? 'Location too rough' : null} />
              {leftMap && (
                <a href={leftMap} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
                  Where they checked out, on the map
                </a>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Not yet: still in the store.</p>
          )}
          {storeMap && (
            <a href={storeMap} target="_blank" rel="noreferrer" className="block font-semibold text-brand hover:underline">
              The store, on the map
            </a>
          )}
        </div>
        <div className="space-y-2">
          {selfie ? (
            <a href={selfie} target="_blank" rel="noreferrer" className="block w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selfie} alt={`Check-in photo of ${visit.staff_name}`} className="h-24 w-24 rounded-xl object-cover ring-1 ring-border" />
            </a>
          ) : (
            <p className="text-muted-foreground">{visit.selfie_path ? 'Photo deleted after 24 hours' : 'No photo'}</p>
          )}
        </div>
        {flags.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-destructive sm:col-span-3">
            {flags.map((f, i) => (
              <li key={i}>{f.text.charAt(0).toUpperCase() + f.text.slice(1)}.</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-semibold sm:col-span-3">
          <Link href={movementHref(visit.user_id, visit.visit_date)} className="text-brand hover:underline">
            Movement that day
          </Link>
          <Link href={`/admin/excuses?${excuse.toString()}`} className="text-brand hover:underline">
            Check “I was at the store” for this visit
          </Link>
        </div>
      </div>
    </details>
  )
}

export function BreakdownTable({
  kind,
  rows,
  shortMinutes,
  ranged,
  from,
  to,
  href,
}: {
  kind: 'stores' | 'people'
  rows: Breakdown[]
  shortMinutes: number
  ranged: boolean
  from: string
  to: string
  href: (over: Partial<VisitFilter>) => string
}) {
  const stores = kind === 'stores'
  return (
    <Card>
      <CardHeader>
        <CardTitle>{stores ? 'Visits by store' : 'Visits by person'}</CardTitle>
        <CardDescription>
          {stores
            ? 'Which stores got attention, and how much. Tap a store to see its visits.'
            : 'Who covered how many stores, and for how long. Tap a name to see their visits.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No store visits recorded for that period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{stores ? 'Store' : 'Person'}</TableHead>
                <TableHead>Visits</TableHead>
                <TableHead>{stores ? 'People' : 'Stores'}</TableHead>
                <TableHead>Time in store</TableHead>
                <TableHead>Average</TableHead>
                <TableHead>Under {shortMinutes} min</TableHead>
                <TableHead>Away on arrival</TableHead>
                <TableHead>Last visit</TableHead>
                {!stores && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">
                    {r.id ? (
                      <Link
                        href={href(stores ? { outlet_id: r.id, view: 'visits' } : { user_id: r.id, view: 'visits' })}
                        className="hover:underline"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      <span>
                        {r.name}
                        <span className="block text-xs font-normal text-muted-foreground">not on Xtend’s store list</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.visits}</TableCell>
                  <TableCell className="tabular-nums">{r.other}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{duration(r.minutes)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.averageMinutes != null ? duration(r.averageMinutes) : '—'}</TableCell>
                  <TableCell className={cn('tabular-nums', r.short > 0 && 'font-semibold text-destructive')}>{r.short}</TableCell>
                  <TableCell className={cn('tabular-nums', r.offSite > 0 && 'font-semibold text-destructive')}>{r.offSite}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatLagos(r.last, ranged)}</TableCell>
                  {!stores && r.id && (
                    <TableCell>
                      <Link href={movementHref(r.id, from, to)} className="text-xs font-semibold text-brand hover:underline">
                        Movement
                      </Link>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function Coverage({
  rows,
  counts,
  gap,
  href,
  isAdmin,
}: {
  rows: Covered[]
  counts: ReturnType<typeof coverageCounts>
  gap: number | null
  href: (over: Partial<VisitFilter>) => string
  isAdmin: boolean
}) {
  const shown = gap ? notVisitedIn(rows, gap) : rows
  const over = { 7: counts.over7, 14: counts.over14, 30: counts.over30 } as Record<number, number>
  return (
    <Card>
      <CardHeader>
        <CardTitle>Store coverage</CardTitle>
        <CardDescription>
          {isAdmin ? 'Every active store' : 'The stores your team covers or has visited'}, with the last visit on
          record, longest without one first. This list ignores the dates above. “Covered by” counts the staff whose
          store it is.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link href={href({ gap: null })} className={chip(!gap)}>
            All ({counts.stores})
          </Link>
          {GAPS.map((g) => (
            <Link key={g} href={href({ gap: g })} className={chip(gap === g)}>
              Not visited in {g}+ days ({over[g]})
            </Link>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {gap ? `Every store has had a visit in the last ${gap} days.` : 'No stores to show.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Last visit</TableHead>
                <TableHead>Days since</TableHead>
                <TableHead>Visits, 30 days</TableHead>
                <TableHead>Covered by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.outlet_id}>
                  <TableCell className="min-w-[180px]">
                    <Link href={href({ outlet_id: r.outlet_id, view: 'visits', gap: null })} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.address && <span className="block max-w-xs truncate text-xs text-muted-foreground">{r.address}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.last_visit_at ? (
                      <>
                        {formatLagos(r.last_visit_at)}
                        <span className="block text-xs text-muted-foreground">{r.last_visit_by}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.daysSince === null || r.daysSince >= 30
                          ? 'destructive'
                          : r.daysSince >= 7
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {r.daysSince === null ? 'No visit' : r.daysSince === 0 ? 'Today' : `${r.daysSince} day${r.daysSince === 1 ? '' : 's'}`}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{r.visits_30d}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.staff_assigned ? `${r.staff_assigned} ${r.staff_assigned === 1 ? 'person' : 'people'}` : <span className="text-muted-foreground">Nobody</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function Figure({ label, value, note, warn, href }: { label: string; value: string; note?: string; warn?: boolean; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold tabular-nums', warn && 'text-destructive')}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {href && <p className="text-xs font-semibold text-brand">Show them →</p>}
    </>
  )
  return href ? (
    <Link href={href} className="surface block p-4 hover:ring-1 hover:ring-brand/40">
      {body}
    </Link>
  ) : (
    <div className="surface p-4">{body}</div>
  )
}

export function Fact({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <p className="min-w-0 break-words">
      <span className="font-semibold text-muted-foreground">{k}: </span>
      <span>{v ?? '—'}</span>
    </p>
  )
}
