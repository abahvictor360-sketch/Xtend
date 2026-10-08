import 'server-only'
import type { ExportRow, Sheet } from '@/lib/export/render'
import type { AttendanceDetail } from '@/lib/types'
import {
  clock,
  concerns,
  delta,
  hoursText,
  lateness,
  minutesOf,
  percent,
  summarise,
  type DayRecord,
  type GroupRow,
  type Person,
  type Summary,
} from '@/lib/attendance-report'
import type { ReportFilter } from '@/lib/attendance-server'
import { metres } from '@/lib/utils'

const STATUS: Record<DayRecord['status'], string> = {
  on_time: 'On time',
  late: 'Late',
  off_site: 'Off site',
  absent: 'Absent',
  rest: 'Sunday',
  none: '',
}

function summaryLines(s: Summary) {
  return [
    `${s.people} people. Came in on ${s.present} of ${s.expected} working days (${percent(s.turnout)}); absent on ${s.absent}.`,
    `On time on ${s.onTime} of ${s.present} clock-ins (${percent(s.punctuality)}); late on ${s.late}${s.avgLateMin !== null ? `, by ${lateness(s.avgLateMin)} on average` : ''}.`,
    `Clocked in off site or flagged on ${s.offSite} days. No clock-out on ${s.missingOut} days. Usual clock-in ${clock(s.avgIn)}.`,
  ]
}

function filterLine(f: ReportFilter, people: Person[]) {
  const who = f.user_id ? people.find((p) => p.id === f.user_id)?.name : null
  return [
    `${f.from} to ${f.to}`,
    who ? `person: ${who}` : null,
    f.outlet_id ? 'one store' : null,
    f.team ? 'one team' : null,
    f.role ? `role: ${f.role.replace('custom:', 'added role ')}` : null,
    f.status ? `days: ${f.status.replace('_', ' ')}` : null,
    f.sundays ? 'Sundays count as working days' : 'Sundays not counted as absences',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The Attendance page's day-by-day table, every row, with a summary on top. */
export function attendanceDaysSheet(
  rows: DayRecord<AttendanceDetail>[],
  all: DayRecord<AttendanceDetail>[],
  people: Person[],
  filter: ReportFilter,
): Sheet {
  const person = new Map(people.map((p) => [p.id, p]))
  const s = summarise(all)
  const worry = concerns(all, people, 20)
  const body: ExportRow[] = [...rows]
    .sort((a, b) => b.date.localeCompare(a.date) || (person.get(a.userId)?.name ?? '').localeCompare(person.get(b.userId)?.name ?? ''))
    .map((r) => {
      const p = person.get(r.userId)
      // The CSV keeps the address itself; the other formats show "Map" as a link.
      const map = r.clockIn ? `https://www.google.com/maps?q=${r.clockIn.lat},${r.clockIn.lng}` : null
      const flags = [
        r.flagged ? 'Flagged' : r.offSite ? 'Off site' : null,
        r.missingOut ? 'No clock-out' : null,
        r.onShift ? 'On shift' : null,
        (r.sentLateMin ?? 0) >= 5 ? `Sent ${lateness(r.sentLateMin!)} after the photo` : null,
      ].filter(Boolean)
      return {
        link: map,
        values: [
          r.date,
          p?.name ?? '',
          p?.roleLabel ?? '',
          p?.teamName ?? '',
          r.outletName ?? '',
          r.present ? (r.late ? 'Late' : 'On time') : STATUS[r.status],
          r.present ? clock(r.inMinutes) : '',
          r.minutesLate ? lateness(r.minutesLate) : '',
          r.clockOut ? clock(minutesOf(r.clockOut.local_time)) : '',
          r.hours !== null ? hoursText(r.hours) : '',
          r.clockIn ? metres(r.clockIn.distance_m) : '',
          flags.join(', '),
          r.clockIn?.location_label ?? '',
          map ?? '',
        ],
      }
    })
  const columns = [
    'Date',
    'Person',
    'Role',
    'Supervisor',
    'Store',
    'How it went',
    'Clock in',
    'Late by',
    'Clock out',
    'Hours',
    'From store',
    'Also',
    'Where they clocked in',
    'Map',
  ] as const
  return {
    title: 'Xtend attendance, day by day',
    subtitle: `${filterLine(filter, people)}. Times are Lagos time.`,
    notes: [
      ...summaryLines(s),
      ...(worry.length ? ['', 'Worth a look:', ...worry.map((c) => `• ${c.text}`)] : []),
    ].join('\n'),
    wrap: true,
    sheetName: 'Days',
    columns,
    rows: body,
    widths: {
      xlsx: [12, 24, 16, 18, 24, 10, 9, 10, 9, 12, 11, 28, 42, 10],
      pdf: [46, 70, 50, 52, 66, 38, 32, 36, 34, 46, 38, 72, 154, 30],
    },
    linkColumn: columns.length - 1,
    linkText: 'Map',
    noLinkText: '',
    fileBase: 'xtend-attendance-days',
  }
}

const BY_LABEL = { person: 'Person', store: 'Store', team: 'Supervisor' } as const

/** The Analytics page's comparison table, with the period before alongside. */
export function analyticsSheet(
  rows: GroupRow[],
  before: Map<string, GroupRow>,
  now: Summary,
  then: Summary,
  filter: ReportFilter,
  people: Person[],
  previous: { from: string; to: string },
): Sheet {
  const change = (a: number | null, b: number | null, up: boolean) => {
    const d = delta(a, b, up)
    return d.change === null ? '' : `${d.change > 0 ? '+' : ''}${Math.round(d.change)}`
  }
  const body: ExportRow[] = rows.map((r) => {
    const b = before.get(r.key) ?? null
    return {
      values: [
        r.label,
        String(r.expected),
        String(r.present),
        String(r.absent),
        percent(r.turnout),
        String(r.late),
        percent(r.punctuality),
        change(r.punctuality, b?.punctuality ?? null, true),
        String(r.offSite),
        String(r.missingOut),
        clock(r.avgIn),
        r.avgLateMin !== null ? lateness(r.avgLateMin) : '',
      ],
    }
  })
  return {
    title: `Xtend punctuality and attendance, by ${BY_LABEL[filter.by].toLowerCase()}`,
    subtitle: `${filterLine(filter, people)}. Compared with ${previous.from} to ${previous.to}.`,
    notes: [
      'This period:',
      ...summaryLines(now),
      '',
      'The period before:',
      ...summaryLines(then),
    ].join('\n'),
    sheetName: 'Analytics',
    columns: [
      BY_LABEL[filter.by],
      'Working days',
      'Came in',
      'Absent',
      'Turned up',
      'Late',
      'On time',
      'On time, change (points)',
      'Off site',
      'No clock-out',
      'Usual clock-in',
      'Late by, on average',
    ],
    rows: body,
    widths: {
      xlsx: [28, 13, 10, 10, 11, 8, 10, 14, 10, 13, 13, 16],
      pdf: [150, 60, 54, 54, 58, 44, 54, 72, 54, 62, 62, 70],
    },
    fileBase: `xtend-analytics-by-${filter.by}`,
  }
}
