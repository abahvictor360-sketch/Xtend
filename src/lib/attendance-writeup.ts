/**
 * The written account at the top of the attendance report: how the day (or
 * the days) went, then who did not clock in, who was late, who clocked in
 * away from their store, who had network trouble, who the office clocked
 * in, and who did not clock out. Plain English, names first. Pure, so
 * scripts/check-attendance.ts can test it.
 *
 * Lines starting "## " are headings and "• " points (lib/export/render.ts).
 */
import { clock, concerns, lateness, percent, summarise, type ClockEvent, type DayRecord, type Person } from '@/lib/attendance-report'
import { longDate, metres } from '@/lib/utils'

/** A clock-in that reached Xtend this long after its photo had no signal. */
export const NETWORK_MIN = 5
/** Names listed per section; the table has the rest. */
const MAX_NAMES = 40

type Event = ClockEvent & { location_label?: string | null; device_info?: Record<string, unknown> | null }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function shortDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
}

export function attendanceWriteUp<E extends Event>(
  all: DayRecord<E>[],
  people: Person[],
  range: { from: string; to: string },
): string[] {
  const person = new Map(people.map((p) => [p.id, p]))
  const name = (r: DayRecord<E>) => person.get(r.userId)?.name ?? 'Someone'
  const single = range.from === range.to
  const when = (r: DayRecord<E>) => (single ? '' : `, ${shortDay(r.date)}`)
  const s = summarise(all)
  const lines: string[] = []

  const section = (title: string, rows: DayRecord<E>[], line: (r: DayRecord<E>) => string) => {
    if (!rows.length) return
    lines.push('', `## ${title} (${rows.length})`)
    for (const r of rows.slice(0, MAX_NAMES)) lines.push(`• ${line(r)}`)
    if (rows.length > MAX_NAMES) lines.push(`• and ${rows.length - MAX_NAMES} more: see the table.`)
  }
  const byName = (a: DayRecord<E>, b: DayRecord<E>) => b.date.localeCompare(a.date) || name(a).localeCompare(name(b))

  // The overview.
  const present = all.filter((r) => r.present)
  const out = present.filter((r) => r.clockOut)
  const onShift = present.filter((r) => r.onShift)
  const leave = all.filter((r) => !r.present && r.status === 'leave').length
  const off = all.filter((r) => !r.present && r.status === 'off').length
  lines.push(single ? `## How ${longDate(range.from)} went` : `## How ${longDate(range.from)} to ${longDate(range.to)} went`)
  if (!s.expected && !present.length) {
    lines.push('Nobody was expected at work, and nobody clocked in.')
  } else {
    lines.push(
      `${s.present} of ${plural(s.expected, single ? 'person' : 'working day', single ? 'people' : 'working days')} expected at work clocked in (${percent(s.turnout)}). ` +
        `${s.onTime} on time and ${s.late} late${s.avgLateMin !== null ? `, ${lateness(s.avgLateMin)} late on average` : ''}. ` +
        `${s.absent} did not clock in.` +
        (leave || off ? ` ${[leave ? `${leave} on leave` : '', off ? `${off} on a day off` : ''].filter(Boolean).join(' and ')}, not counted as absent.` : ''),
    )
    lines.push(
      `${out.length} clocked in and out` +
        (onShift.length ? `; ${onShift.length} still on shift` : '') +
        (s.missingOut ? `; ${s.missingOut} did not clock out` : '') +
        `. ${s.offSite ? `${plural(s.offSite, 'clock-in')} away from the store or with a rough location. ` : 'Every clock-in was at the store. '}` +
        (s.avgIn !== null ? `Usual clock-in time ${clock(s.avgIn)}.` : ''),
    )
  }

  section('Did not clock in', all.filter((r) => r.status === 'absent').sort(byName), (r) =>
    `${name(r)}${when(r)} — ${person.get(r.userId)?.outletName ?? 'no store'}`,
  )
  section(
    'Late',
    all.filter((r) => r.present && r.late).sort((a, b) => (b.minutesLate ?? 0) - (a.minutesLate ?? 0)),
    (r) => `${name(r)}${when(r)} — in at ${clock(r.inMinutes)}, ${lateness(r.minutesLate ?? 0)} late, ${r.outletName ?? 'no store'}`,
  )
  section('Clocked in away from their store', all.filter((r) => r.present && r.offSite).sort(byName), (r) => {
    const e = r.clockIn as E
    const where = e?.location_label ? ` (at ${e.location_label})` : ''
    return r.flagged
      ? `${name(r)}${when(r)} — location too rough to confirm, ${r.outletName ?? 'no store'}${where}`
      : `${name(r)}${when(r)} — ${metres(e?.distance_m ?? null)} from ${r.outletName ?? 'their store'}${where}`
  })
  section(
    'Network trouble',
    all.filter((r) => (r.sentLateMin ?? 0) >= NETWORK_MIN).sort((a, b) => (b.sentLateMin ?? 0) - (a.sentLateMin ?? 0)),
    (r) => `${name(r)}${when(r)} — no signal at clock-in: it reached Xtend ${lateness(r.sentLateMin ?? 0)} after the photo`,
  )
  section(
    'Clocked in by the office',
    all.filter((r) => (r.clockIn as E | null)?.device_info?.source === 'office').sort(byName),
    (r) => {
      const why = (r.clockIn as E).device_info?.reason
      return `${name(r)}${when(r)}${typeof why === 'string' && why ? ` — ${why}` : ''}`
    },
  )
  section('Did not clock out', all.filter((r) => r.missingOut).sort(byName), (r) => `${name(r)}${when(r)} — in at ${clock(r.inMinutes)}, ${r.outletName ?? 'no store'}`)
  section('Still on shift', onShift.sort(byName), (r) => `${name(r)} — in at ${clock(r.inMinutes)}, ${r.outletName ?? 'no store'}`)

  const worry = concerns(all, people, 20)
  if (worry.length && !single) {
    lines.push('', '## Worth a look')
    for (const c of worry) lines.push(`• ${c.text}`)
  }
  return lines
}
