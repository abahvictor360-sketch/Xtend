import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AttendanceFilters } from '@/components/admin/attendance-filters'
import { ChartKey, RankList, StackChart, type RankRow } from '@/components/admin/analytics-charts'
import { DAY_COLOUR, ORANGE } from '@/lib/chart-colours'
import {
  byHour,
  byWeekday,
  clock,
  dayMonth,
  delta,
  group,
  lateness,
  leaders,
  percent,
  presets,
  storeCoverage,
  summarise,
  trend,
  type Delta,
  type GroupRow,
} from '@/lib/attendance-report'
import { MAX_RANGE_DAYS, loadAnalytics, parseReportFilter, reportQuery, type ReportFilter } from '@/lib/attendance-server'
import { cn, longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Analytics — Xtend' }

/** Clock-ins somebody needs before their punctuality is ranked. */
const MIN_DAYS = 3

type Search = Record<string, string | string[] | undefined>

const NOUN = { person: 'people', store: 'stores', team: 'teams' } as const

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor'])
  const filter = parseReportFilter(await searchParams, 30)
  const supabase = await createServerSupabase()

  let loaded: Awaited<ReturnType<typeof loadAnalytics>>
  try {
    loaded = await loadAnalytics(supabase, filter)
  } catch (e) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold">Punctuality and attendance</h1>
        <Alert variant="destructive">Could not load analytics: {(e as Error).message}</Alert>
      </div>
    )
  }
  const { choices, today, previous, now, before } = loaded
  const s = summarise(now.records)
  const was = summarise(before.records)
  const opts = { today, sundays: filter.sundays }

  const rows = group(now.records, now.people, filter.by)
  const earlier = new Map(group(before.records, before.people, filter.by).map((r) => [r.key, r]))
  const ranked = rows.filter((r) => r.present >= MIN_DAYS)
  const href = (r: GroupRow) =>
    r.key === 'none'
      ? undefined
      : `/admin/attendance?${reportQuery(
          { from: filter.from, to: filter.to, sundays: filter.sundays },
          filter.by === 'person' ? { user_id: r.key } : filter.by === 'store' ? { outlet_id: r.key } : { team: r.key },
        )}`
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  const rank = (list: GroupRow[], value: (r: GroupRow) => number, text: (r: GroupRow) => string): RankRow[] =>
    list.map((r) => ({ key: r.key, label: r.label, value: value(r), text: text(r), detail: `${r.present} clock-ins, ${r.absent} absent`, href: href(r) }))

  const moved = ranked
    .map((r) => ({ r, d: delta(r.punctuality, earlier.get(r.key)?.punctuality ?? null, true).change }))
    .filter((x): x is { r: GroupRow; d: number } => x.d !== null && x.d !== 0)
  const slipped = moved.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5)

  const trendRows = trend(now.records, now.days)
  const weekdays = byWeekday(now.records)
  const hours = byHour(now.records)
  const cover = storeCoverage(now.records, now.people, now.days, opts)
  const weekly = now.days.length > 45

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Punctuality and attendance</h1>
        <p className="text-sm text-muted-foreground">
          How the team is turning up over a period, and how that compares with the same number of days just before. Late
          means clocking in after the store’s opening time; a working day without a clock-in is an absence.
        </p>
      </div>

      <AttendanceFilters
        mode="analytics"
        filter={filter}
        choices={choices}
        today={today}
        presets={presets(today, ['week', 'last_week', '7d', '30d', 'month', 'last_month', '90d'])}
        presetHref={(p) => `?${reportQuery({ ...filter, from: p.from, to: p.to })}`}
        downloads={[{ label: `Download the table by ${filter.by}`, base: '/api/admin/export/analytics', query: reportQuery(filter) }]}
      />

      {filter.clipped && <Alert variant="info">Showing the last {MAX_RANGE_DAYS} days of the range you picked.</Alert>}
      {loaded.truncated && <Alert variant="warning">There are more clock records than one page can read. Pick fewer days.</Alert>}

      <p className="text-sm">
        <span className="font-semibold">
          {longDate(filter.from)} to {longDate(filter.to)}
        </span>
        <span className="text-muted-foreground">
          {' '}
          · {now.days.length} days, {s.people} people · compared with {dayMonth(previous.from)} to {dayMonth(previous.to)}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Figure label="On time" value={percent(s.punctuality)} was={percent(was.punctuality)} d={delta(s.punctuality, was.punctuality, true)} unit=" points" />
        <Figure label="Turned up" value={percent(s.turnout)} was={percent(was.turnout)} d={delta(s.turnout, was.turnout, true)} unit=" points" />
        <Figure label="Late days" value={String(s.late)} was={String(was.late)} d={delta(s.late, was.late, false)} />
        <Figure label="Absent days" value={String(s.absent)} was={String(was.absent)} d={delta(s.absent, was.absent, false)} />
        <Figure label="Off site or flagged" value={String(s.offSite)} was={String(was.offSite)} d={delta(s.offSite, was.offSite, false)} />
        <Figure label="No clock-out" value={String(s.missingOut)} was={String(was.missingOut)} d={delta(s.missingOut, was.missingOut, false)} />
        <Figure
          label="Usual clock-in"
          value={clock(s.avgIn)}
          was={clock(was.avgIn)}
          d={delta(s.avgIn, was.avgIn, false)}
          unit=" min"
          note={s.avgLateMin !== null ? `late ones ${lateness(s.avgLateMin)} late` : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{weekly ? 'Week by week' : 'Day by day'}</CardTitle>
          <CardDescription>Everybody expected, split by how the day went. Point at a column for its figures.</CardDescription>
        </CardHeader>
        <CardContent>
          <StackChart
            total="Expected"
            columns={trendRows.map((t) => ({
              key: t.date,
              label: t.label,
              long: t.long,
              parts: [
                { label: 'On time', value: t.onTime, colour: DAY_COLOUR.on_time },
                { label: 'Late', value: t.late, colour: DAY_COLOUR.late },
                { label: 'Absent', value: t.absent, colour: DAY_COLOUR.absent },
              ],
              notes: [`On time: ${percent(t.punctuality)}`, `Off site or flagged: ${t.offSite}`, `No clock-out: ${t.missingOut}`],
            }))}
          />
          <ChartKey
            parts={[
              { label: 'On time', colour: DAY_COLOUR.on_time },
              { label: 'Late', colour: DAY_COLOUR.late },
              { label: 'Absent', colour: DAY_COLOUR.absent },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>On time, by weekday</CardTitle>
            <CardDescription>Share of clock-ins that were on time on each day of the week.</CardDescription>
          </CardHeader>
          <CardContent>
            <StackChart
              max={100}
              unit="%"
              total={null}
              height="h-52"
              columns={weekdays.map((w) => ({
                key: String(w.day),
                label: w.label,
                long: w.long,
                parts: [{ label: 'On time', value: w.punctuality ?? 0, colour: ORANGE.main }],
                notes: [`${w.present} clock-ins, ${w.late} late`, `${w.absent} absent · turned up ${percent(w.turnout)}`],
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>When people clock in</CardTitle>
            <CardDescription>Clock-ins by the hour they happened.</CardDescription>
          </CardHeader>
          <CardContent>
            <StackChart
              height="h-52"
              total="Clock-ins"
              columns={hours.map((h) => ({
                key: String(h.hour),
                label: h.label.slice(0, 2),
                long: `${h.label} to ${String(h.hour).padStart(2, '0')}:59`,
                parts: [
                  { label: 'On time', value: h.onTime, colour: DAY_COLOUR.on_time },
                  { label: 'Late', value: h.late, colour: ORANGE.light },
                ],
              }))}
            />
            <ChartKey
              parts={[
                { label: 'On time', colour: DAY_COLOUR.on_time },
                { label: 'Late', colour: ORANGE.light },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">Who stands out, by {filter.by}</h2>
          <p className="text-sm text-muted-foreground">
            Punctuality is ranked only with {MIN_DAYS} or more clock-ins. Tap a name to open their days on Attendance.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Board title="Most on time">
            <RankList of={100} rows={rank(leaders(ranked, (r) => r.punctuality, 5), (r) => r.punctuality ?? 0, (r) => percent(r.punctuality))} />
          </Board>
          <Board title="Least on time">
            <RankList
              of={100}
              colour={ORANGE.deep}
              rows={rank(leaders(ranked, (r) => r.punctuality, 5, true), (r) => r.punctuality ?? 0, (r) => percent(r.punctuality))}
            />
          </Board>
          <Board title="Slipped most since the period before">
            <RankList
              colour={ORANGE.deep}
              rows={slipped.map(({ r, d }) => ({
                key: r.key,
                label: r.label,
                value: -d,
                text: `−${Math.round(-d)} pts`,
                detail: `${percent(earlier.get(r.key)?.punctuality ?? null)} before, ${percent(r.punctuality)} now`,
                href: href(r),
              }))}
            />
          </Board>
          <Board title="Most absences">
            <RankList colour={ORANGE.dark} rows={rank(leaders(rows, (r) => r.absent), (r) => r.absent, (r) => days(r.absent))} />
          </Board>
          <Board title="Most days off site or flagged">
            <RankList colour={ORANGE.deep} rows={rank(leaders(rows, (r) => r.offSite), (r) => r.offSite, (r) => days(r.offSite))} />
          </Board>
          <Board title="Most days without a clock-out">
            <RankList colour={ORANGE.light} rows={rank(leaders(rows, (r) => r.missingOut), (r) => r.missingOut, (r) => days(r.missingOut))} />
          </Board>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Store coverage</CardTitle>
          <CardDescription>
            On how many working days at least one person clocked in at each store. Least covered first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cover.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stores to show.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {cover.slice(0, 40).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <Link
                    href={`/admin/attendance?${reportQuery({ from: filter.from, to: filter.to, outlet_id: c.id, sundays: filter.sundays })}`}
                    className="min-w-0 flex-1 basis-40 truncate font-semibold hover:text-brand hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="w-20 text-xs text-muted-foreground">
                    {c.people} {c.people === 1 ? 'person' : 'people'}
                  </span>
                  <span className="flex w-full items-center gap-2 sm:w-56">
                    <span className="relative h-3 flex-1 overflow-hidden rounded" style={{ background: ORANGE.track }}>
                      <span
                        className="absolute inset-y-0 left-0 rounded"
                        style={{ width: `${c.pct ?? 0}%`, background: (c.pct ?? 0) < 80 ? ORANGE.deep : ORANGE.main }}
                      />
                    </span>
                    <span className="w-24 text-right text-xs font-semibold tabular-nums">
                      {c.covered}/{c.workingDays} · {percent(c.pct)}
                    </span>
                  </span>
                  <span className="w-full text-xs text-muted-foreground sm:w-auto sm:basis-60">
                    {c.gaps.length
                      ? `Nobody in: ${c.gaps.slice(-4).map(dayMonth).join(', ')}${c.gaps.length > 4 ? ` and ${c.gaps.length - 4} more` : ''}`
                      : 'Somebody in every working day'}
                    {c.lastIn ? ` · last clock-in ${dayMonth(c.lastIn)}` : ' · no clock-in in this period'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {cover.length > 40 && <p className="mt-2 text-xs text-muted-foreground">The 40 least covered of {cover.length} stores.</p>}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">
          All {NOUN[filter.by]} ({rows.length})
        </h2>
        <CompareTable rows={rows} earlier={earlier} by={filter.by} href={href} />
      </section>
    </div>
  )
}

function Change({ d, unit = '' }: { d: Delta; unit?: string }) {
  if (d.change === null) return <span className="text-muted-foreground">no earlier figure</span>
  if (Math.round(d.change) === 0) return <span className="text-muted-foreground">no change</span>
  return (
    <span className={cn('font-semibold', d.better ? 'text-success' : 'text-destructive')}>
      {d.change > 0 ? '▲' : '▼'} {Math.abs(Math.round(d.change))}
      {unit}
    </span>
  )
}

function Figure({ label, value, was, d, unit, note }: { label: string; value: string; was: string; d: Delta; unit?: string; note?: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight">
        <Change d={d} unit={unit} />
        <span className="text-muted-foreground"> · was {was}</span>
      </p>
      {note && <p className="text-[11px] leading-tight text-muted-foreground">{note}</p>}
    </div>
  )
}

function Board({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface p-4">
      <h3 className="mb-2 text-sm font-bold">{title}</h3>
      {children}
    </div>
  )
}

function CompareTable({
  rows,
  earlier,
  by,
  href,
}: {
  rows: GroupRow[]
  earlier: Map<string, GroupRow>
  by: ReportFilter['by']
  href: (r: GroupRow) => string | undefined
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in this period.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{by === 'person' ? 'Person' : by === 'store' ? 'Store' : 'Team'}</TableHead>
            <TableHead>Came in</TableHead>
            <TableHead>Absent</TableHead>
            <TableHead>Late</TableHead>
            <TableHead>On time</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Off site</TableHead>
            <TableHead>No clock-out</TableHead>
            <TableHead>Usual in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const link = href(r)
            return (
              <TableRow key={r.key}>
                <TableCell className="whitespace-nowrap font-medium">
                  {link ? (
                    <Link href={link} className="hover:text-brand hover:underline">
                      {by === 'team' && r.key !== 'none' ? `${r.label}’s team` : r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {r.present}/{r.expected}
                </TableCell>
                <TableCell className={cn('tabular-nums', r.absent > 0 && 'text-destructive')}>{r.absent}</TableCell>
                <TableCell className="tabular-nums">{r.late}</TableCell>
                <TableCell className="font-semibold tabular-nums">{percent(r.punctuality)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  <Change d={delta(r.punctuality, earlier.get(r.key)?.punctuality ?? null, true)} unit=" pts" />
                </TableCell>
                <TableCell className="tabular-nums">{r.offSite}</TableCell>
                <TableCell className="tabular-nums">{r.missingOut}</TableCell>
                <TableCell className="tabular-nums">{clock(r.avgIn)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
