import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { avatarUrls } from '@/lib/avatars'
import { Alert } from '@/components/ui/alert'
import { AlarmClock, CalendarDays, Grid3X3, ListChecks, UserX, Users } from 'lucide-react'
import {
  AttendanceStats,
  SectionTitle,
  TodayPanel,
  WorthALook,
  type TodayItem,
  type WorryItem,
} from '@/components/admin/attendance-overview'
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
import { fetchVisits } from '@/lib/export/visits'
import { toDayVisit, type DayVisit } from '@/components/admin/visit-photo-list'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Attendance — Xtend' }

/** Days handed to the table at once; the download has the rest. */
const TABLE_MAX = 1500

type Search = Record<string, string | string[] | undefined>

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor', 'hr'])
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

  const tableRows = shown.slice(0, TABLE_MAX)
  // Profile photos for the map's pins: only the people in the list, through
  // the person's own session (storage rules decide whose photos they see).
  const photos = await avatarUrls(supabase, [...new Set(tableRows.map((r) => r.userId))])
  const tablePeople: Record<string, TablePerson> = Object.fromEntries(
    people.map((p) => [
      p.id,
      {
        name: p.name,
        phone: p.phone,
        store: p.outletName,
        team: p.teamName ? `${p.teamName}’s team` : null,
        role: p.roleLabel,
        photo: photos.get(p.id) ?? null,
      },
    ]),
  )

  // Store check-ins and check-outs (marketers, and anyone who visits
  // stores) for the days in the table, with both photos when a row opens.
  const visitsByDay: Record<string, DayVisit[]> = {}
  try {
    const wanted = new Set(tableRows.map((r) => r.key))
    const rows = await fetchVisits(supabase, { from: filter.from, to: filter.to, user_id: filter.user_id, limit: 5000 })
    for (const v of [...rows].sort((a, b) => Date.parse(a.arrived_at) - Date.parse(b.arrived_at))) {
      const key = `${v.user_id}|${v.visit_date}`
      if (wanted.has(key)) (visitsByDay[key] ??= []).push(toDayVisit(v))
    }
  } catch {
    // Store visits are extra here: the attendance still shows without them.
  }

  const todayRecords = filter.to === today ? records.filter((r) => r.date === today) : []
  const notIn = todayRecords.filter((r) => r.status === 'absent')
  const lateToday = todayRecords.filter((r) => r.late).sort((a, b) => (b.minutesLate ?? 0) - (a.minutesLate ?? 0))
  const onShift = todayRecords.filter((r) => r.onShift).length
  const person = new Map(people.map((p) => [p.id, p]))
  const range = single ? longDate(filter.from) : `${longDate(filter.from)} to ${longDate(filter.to)}`

  const todayItem = (r: DayRecord, line: string): TodayItem => {
    const p = person.get(r.userId)!
    return {
      key: r.key,
      name: p.name,
      line,
      team: p.teamName ? `${p.teamName}’s team` : null,
      phone: p.phone,
      dayHref: `/admin/attendance/day?person=${r.userId}&date=${today}`,
      movementHref: `/admin/tracking?person=${p.id}&date=${today}&until=${today}`,
    }
  }
  const worryItems: WorryItem[] = worry.map((c) => {
    const last = c.dates[c.dates.length - 1]
    return {
      key: `${c.userId}-${c.kind}`,
      text: c.text,
      daysHref: `?${reportQuery({ ...filter, user_id: c.userId, status: null })}`,
      excuse:
        c.kind === 'absent' || c.kind === 'late'
          ? {
              href: `/admin/excuses?person=${c.userId}&date=${last}&until=${last}&from=06:00&to=12:00`,
              label: `Check an excuse for ${last === today ? 'today' : 'the last one'}`,
            }
          : undefined,
    }
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Attendance</h1>
          <p className="text-sm text-muted-foreground">Who came, when and where, day by day. Lagos time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-semibold">
            <CalendarDays className="h-4 w-4 text-brand" />
            {range}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-semibold">
            <Users className="h-4 w-4 text-brand" />
            {summary.people} {summary.people === 1 ? 'person' : 'people'}
          </span>
        </div>
      </header>

      <section className="surface p-4 sm:p-5">
        <AttendanceFilters
          mode="attendance"
          filter={filter}
          choices={choices}
          today={today}
          presets={presets(today, ['today', 'yesterday', 'week', '7d', '30d', 'month'])}
          presetHref={(p) => `?${reportQuery({ ...filter, from: p.from, to: p.to })}`}
          statusHref={(status) => `?${reportQuery({ ...filter, status })}#days`}
          roleHref={(role) => `?${reportQuery({ ...filter, role })}#days`}
          downloads={[
            { label: 'Download day by day', base: '/api/admin/export/attendance', query },
            { label: 'Clock-ins and outs with photos (one row a day)', base: '/api/admin/export', query: rawQuery },
          ]}
        />
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold hover:text-foreground">How attendance is counted</summary>
          <p className="mt-1.5 leading-relaxed">
            On time or late is against their store’s opening time; at the store or away from it is measured from the
            clock-in. A working day on someone’s schedule without a clock-in counts as absent; their days off and approved
            leave do not. Clock records cannot be changed or deleted, only corrected by the office on the day.
          </p>
        </details>
      </section>

      {filter.clipped && <Alert variant="info">Showing the last {MAX_RANGE_DAYS} days of the range you picked.</Alert>}
      {report.truncated && (
        <Alert variant="warning">There are more clock records in this range than one page can read. Pick fewer days.</Alert>
      )}

      <AttendanceStats summary={summary} endsToday={filter.to === today} />

      {filter.to === today && todayRecords.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TodayPanel
            title="Not clocked in today"
            icon={UserX}
            tone="bad"
            note={onShift ? `${onShift} on shift now` : undefined}
            empty="Everybody expected today has clocked in."
            items={notIn.map((r) => todayItem(r, person.get(r.userId)?.outletName ?? 'No store'))}
          />
          <TodayPanel
            title="Late today"
            icon={AlarmClock}
            tone="warn"
            empty="Nobody was late today."
            items={lateToday.map((r) =>
              todayItem(r, `In at ${clock(r.inMinutes)}${r.minutesLate ? `, ${lateness(r.minutesLate)} late` : ''} · ${r.outletName ?? 'No store'}`),
            )}
          />
        </div>
      )}

      <WorthALook items={worryItems} />

      {!single && days.length <= GRID_MAX_DAYS && (
        <section className="surface space-y-4 p-4 sm:p-5">
          <SectionTitle icon={Grid3X3} title="Calendar" note="One square per person per day. Point at a square for the times; tap it to open that day." />
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

      <section className="space-y-3">
        <SectionTitle
          id="days"
          icon={ListChecks}
          title="Day by day"
          note={`${shown.length} day${shown.length === 1 ? '' : 's'}${filter.status ? ' matching' : ''} · tap a row for photos, store check-ins and check-outs, map and links; tap a name for their whole day`}
        />
        <AttendanceTable rows={tableRows} people={tablePeople} total={shown.length} visits={visitsByDay} />
      </section>
    </div>
  )
}
