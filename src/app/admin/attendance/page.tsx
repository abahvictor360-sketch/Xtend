import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { AttendanceFilters } from '@/components/admin/attendance-filters'
import { AttendanceGrid } from '@/components/admin/attendance-grid'
import { AttendanceTable, type TablePerson } from '@/components/admin/attendance-table'
import {
  clock,
  concerns,
  lateness,
  percent,
  presets,
  summarise,
  type DayRecord,
  type Person,
} from '@/lib/attendance-report'
import { GRID_MAX_DAYS, MAX_RANGE_DAYS, loadAttendance, parseReportFilter, reportQuery } from '@/lib/attendance-server'
import { cn, longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Attendance — Xtend' }

/** Days handed to the table at once; the download has the rest. */
const TABLE_MAX = 1500

type Search = Record<string, string | string[] | undefined>

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor'])
  const filter = parseReportFilter(await searchParams, 1)
  const supabase = await createServerSupabase()

  let loaded: Awaited<ReturnType<typeof loadAttendance>>
  try {
    loaded = await loadAttendance(supabase, filter)
  } catch (e) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold">Attendance</h1>
        <Alert variant="destructive">Could not load attendance: {(e as Error).message}</Alert>
      </div>
    )
  }
  const { choices, report, shown } = loaded
  const { today, days, people, records } = report
  const summary = summarise(records)
  const worry = concerns(records, people)
  const single = days.length === 1
  const query = reportQuery(filter)
  const rawQuery = new URLSearchParams(
    Object.entries({ from: filter.from, to: filter.to, user_id: filter.user_id, outlet_id: filter.outlet_id }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  ).toString()

  const tablePeople: Record<string, TablePerson> = Object.fromEntries(
    people.map((p) => [p.id, { name: p.name, phone: p.phone, store: p.outletName, team: p.teamName ? `${p.teamName}’s team` : null, role: p.roleLabel }]),
  )
  const tableRows = shown.slice(0, TABLE_MAX)

  const todayRecords = filter.to === today ? records.filter((r) => r.date === today) : []
  const notIn = todayRecords.filter((r) => r.status === 'absent')
  const lateToday = todayRecords.filter((r) => r.late).sort((a, b) => (b.minutesLate ?? 0) - (a.minutesLate ?? 0))
  const onShift = todayRecords.filter((r) => r.onShift).length
  const person = new Map(people.map((p) => [p.id, p]))
  const range = single ? longDate(filter.from) : `${longDate(filter.from)} to ${longDate(filter.to)}`

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Who came, when, and where, day by day: on time or late (against their store’s opening time), at the store or
          away from it, and whether they clocked out. A working day without a clock-in counts as absent. Times are
          Lagos time; clock records cannot be changed or deleted.
        </p>
      </div>

      <AttendanceFilters
        mode="attendance"
        filter={filter}
        choices={choices}
        today={today}
        presets={presets(today, ['today', 'yesterday', 'week', '7d', '30d', 'month'])}
        presetHref={(p) => `?${reportQuery({ ...filter, from: p.from, to: p.to })}`}
        downloads={[
          { label: 'Download day by day', base: '/api/admin/export/attendance', query },
          { label: 'Every clock-in and out', base: '/api/admin/export', query: rawQuery },
        ]}
      />

      {filter.clipped && <Alert variant="info">Showing the last {MAX_RANGE_DAYS} days of the range you picked.</Alert>}
      {report.truncated && (
        <Alert variant="warning">There are more clock records in this range than one page can read. Pick fewer days.</Alert>
      )}

      <p className="text-sm font-semibold">
        {range} · {summary.people} {summary.people === 1 ? 'person' : 'people'}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Figure label="Came in" value={String(summary.present)} note={`of ${summary.expected} working day${summary.expected === 1 ? '' : 's'}`} />
        <Figure
          label={filter.to === today ? 'Absent or not in yet' : 'Absent'}
          value={String(summary.absent)}
          warn={summary.absent > 0}
        />
        <Figure
          label="Late"
          value={String(summary.late)}
          note={summary.avgLateMin !== null ? `${lateness(summary.avgLateMin)} late on average` : undefined}
          warn={summary.late > 0}
        />
        <Figure label="Off site or flagged" value={String(summary.offSite)} warn={summary.offSite > 0} />
        <Figure label="No clock-out" value={String(summary.missingOut)} warn={summary.missingOut > 0} />
        <Figure label="On time" value={percent(summary.punctuality)} note="of those who came" />
        <Figure label="Turned up" value={percent(summary.turnout)} note="of working days" />
        <Figure
          label="Usual clock-in"
          value={clock(summary.avgIn)}
          note={summary.avgHours !== null ? `${Math.round(summary.avgHours * 10) / 10} h on shift on average` : undefined}
        />
      </div>

      {filter.to === today && todayRecords.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TodayList
            title={`Not clocked in today (${notIn.length})`}
            empty="Everybody expected today has clocked in."
            rows={notIn}
            person={person}
            note={onShift ? `${onShift} on shift now.` : undefined}
            line={(r, p) => p.outletName ?? 'No store'}
            today={today}
          />
          <TodayList
            title={`Late today (${lateToday.length})`}
            empty="Nobody was late today."
            rows={lateToday}
            person={person}
            line={(r) => `In at ${clock(r.inMinutes)}${r.minutesLate ? `, ${lateness(r.minutesLate)} late` : ''} · ${r.outletName ?? 'No store'}`}
            today={today}
          />
        </div>
      )}

      {worry.length > 0 && (
        <Alert variant="destructive">
          <p className="font-semibold">Worth a look</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {worry.map((c) => (
              <li key={`${c.userId}-${c.kind}`}>
                {c.text}{' '}
                <Link href={`?${reportQuery({ ...filter, user_id: c.userId, status: null })}`} className="font-semibold underline">
                  See their days
                </Link>
                {(c.kind === 'absent' || c.kind === 'late') && (
                  <>
                    {' · '}
                    <Link
                      href={`/admin/excuses?person=${c.userId}&date=${c.dates[c.dates.length - 1]}&until=${c.dates[c.dates.length - 1]}&from=06:00&to=12:00`}
                      className="font-semibold underline"
                    >
                      Check an excuse for {c.dates[c.dates.length - 1] === today ? 'today' : 'the last one'}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {!single && days.length <= GRID_MAX_DAYS && (
        <section className="surface space-y-3 p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-bold">Calendar</h2>
            <p className="text-sm text-muted-foreground">One square per day. Point at a square for the times; tap it to open that day.</p>
          </div>
          <AttendanceGrid
            people={people}
            records={records}
            days={days}
            dayHref={(userId, date) => `?${reportQuery({ ...filter, from: date, to: date, user_id: userId, status: null })}#days`}
          />
        </section>
      )}
      {days.length > GRID_MAX_DAYS && (
        <p className="text-sm text-muted-foreground">Pick {GRID_MAX_DAYS} days or fewer to see the calendar.</p>
      )}

      <section id="days" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Day by day</h2>
          <p className="text-xs text-muted-foreground">
            {shown.length} day{shown.length === 1 ? '' : 's'}
            {filter.status ? ' matching' : ''} · tap a row for photos, map, phone and links
          </p>
        </div>
        <AttendanceTable rows={tableRows} people={tablePeople} total={shown.length} />
      </section>
    </div>
  )
}

function Figure({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold tabular-nums', warn && 'text-destructive')}>{value}</p>
      {note && <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{note}</p>}
    </div>
  )
}

function TodayList({
  title,
  empty,
  rows,
  person,
  line,
  note,
  today,
}: {
  title: string
  empty: string
  rows: DayRecord[]
  person: Map<string, Person>
  line: (r: DayRecord, p: Person) => string
  note?: string
  today: string
}) {
  return (
    <div className="surface p-4 sm:p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto text-sm">
          {rows.map((r) => {
            const p = person.get(r.userId)!
            return (
              <li key={r.key} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {line(r, p)}
                    {p.teamName ? ` · ${p.teamName}’s team` : ''}
                  </span>
                </span>
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="shrink-0 text-xs font-semibold text-brand hover:underline">
                    Call
                  </a>
                )}
                <Link
                  href={`/admin/tracking?person=${p.id}&date=${today}&until=${today}`}
                  className="shrink-0 text-xs font-semibold text-brand hover:underline"
                >
                  Movement
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
