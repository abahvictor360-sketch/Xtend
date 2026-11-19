/**
 * The written account of the attendance report: how the day (or the days)
 * went, then who did not clock in, who was late, who clocked in away from
 * their store, who had network trouble, who the office clocked in, and who
 * did not clock out. Plain English, names first. Pure, so
 * scripts/check-attendance.ts can test it.
 *
 * `writeUpParts` gives the pieces (the designed PDF lays them out as
 * cards); `attendanceWriteUp` gives them as text lines for Word and Excel,
 * "## " a heading and "• " a point (lib/export/render.ts).
 */
import { clock, concerns, lateness, percent, summarise, type ClockEvent, type DayRecord, type Person } from '@/lib/attendance-report'
import { longDate, metres } from '@/lib/utils'

/** A clock-in that reached Xtend this long after its photo had no signal. */
export const NETWORK_MIN = 5
/** Names listed per section; the table has the rest. */
export const MAX_NAMES = 40

type Event = ClockEvent & { location_label?: string | null; device_info?: Record<string, unknown> | null }

export type Tone = 'bad' | 'warn' | 'info' | 'good'

export interface WriteUpItem {
  name: string
  /** Over several days: how many ("3 days"); null for one day. */
  day: string | null
  detail: string
}

export interface WriteUpSection {
  key: 'absent' | 'late' | 'away' | 'network' | 'office' | 'no_out' | 'on_shift'
  title: string
  tone: Tone
  /** Every one (one per person over several days), in order; MAX_NAMES are shown. */
  items: WriteUpItem[]
}

export interface WriteUpParts {
  heading: string
  overview: string[]
  sections: WriteUpSection[]
  worry: string[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function shortDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
}

export function writeUpParts<E extends Event>(all: DayRecord<E>[], people: Person[], range: { from: string; to: string }): WriteUpParts {
  const person = new Map(people.map((p) => [p.id, p]))
  const name = (r: DayRecord<E>) => person.get(r.userId)?.name ?? 'Someone'
  const single = range.from === range.to
  const store = (r: DayRecord<E>) => r.outletName ?? person.get(r.userId)?.outletName ?? 'no store'
  const s = summarise(all)
  const byName = (a: DayRecord<E>, b: DayRecord<E>) => b.date.localeCompare(a.date) || name(a).localeCompare(name(b))
  /**
   * One line per day for a single day. Over several days, one line per
   * person: how many days, then each day with its short note, people with
   * the most days first.
   */
  type Entry = { r: DayRecord<E>; detail: string; short: string }
  const items = (entries: Entry[]): WriteUpItem[] => {
    if (single) return entries.map((e) => ({ name: name(e.r), day: null, detail: e.detail }))
    const groups = new Map<string, Entry[]>()
    for (const e of entries) groups.set(e.r.userId, [...(groups.get(e.r.userId) ?? []), e])
    return [...groups.values()]
      .sort((a, b) => b.length - a.length || name(a[0].r).localeCompare(name(b[0].r)))
      .map((g) => ({
        name: name(g[0].r),
        day: plural(g.length, 'day'),
        detail: [...g]
          .sort((a, b) => a.r.date.localeCompare(b.r.date))
          .map((e) => `${shortDay(e.r.date)}${e.short ? ` (${e.short})` : ''}`)
          .join(', '),
      }))
  }
  const entry = (r: DayRecord<E>, detail: string, short = ''): Entry => ({ r, detail, short })

  const present = all.filter((r) => r.present)
  const out = present.filter((r) => r.clockOut)
  const onShift = present.filter((r) => r.onShift)
  const leave = all.filter((r) => !r.present && r.status === 'leave').length
  const off = all.filter((r) => !r.present && r.status === 'off').length

  const overview: string[] = []
  if (!s.expected && !present.length) {
    overview.push('Nobody was expected at work, and nobody clocked in.')
  } else {
    overview.push(
      `${s.present} of ${plural(s.expected, single ? 'person' : 'working day', single ? 'people' : 'working days')} expected at work clocked in (${percent(s.turnout)}). ` +
        `${s.onTime} on time and ${s.late} late${s.avgLateMin !== null ? `, ${lateness(s.avgLateMin)} late on average` : ''}. ` +
        `${s.absent} did not clock in.` +
        (leave || off ? ` ${[leave ? `${leave} on leave` : '', off ? `${off} on a day off` : ''].filter(Boolean).join(' and ')}, not counted as absent.` : ''),
    )
    overview.push(
      `${out.length} clocked in and out` +
        (onShift.length ? `; ${onShift.length} still on shift` : '') +
        (s.missingOut ? `; ${s.missingOut} did not clock out` : '') +
        `. ${s.offSite ? `${plural(s.offSite, 'clock-in')} away from the store or with a rough location. ` : 'Every clock-in was at the store. '}` +
        (s.avgIn !== null ? `Usual clock-in time ${clock(s.avgIn)}.` : ''),
    )
  }

  const sections: WriteUpSection[] = [
    {
      key: 'absent',
      title: 'Did not clock in',
      tone: 'bad',
      items: items(all.filter((r) => r.status === 'absent').sort(byName).map((r) => entry(r, store(r)))),
    },
    {
      key: 'late',
      title: 'Late',
      tone: 'warn',
      items: items(
        present
          .filter((r) => r.late)
          .sort((a, b) => (b.minutesLate ?? 0) - (a.minutesLate ?? 0))
          .map((r) => entry(r, `In at ${clock(r.inMinutes)}, ${lateness(r.minutesLate ?? 0)} late · ${store(r)}`, `${lateness(r.minutesLate ?? 0)} late`)),
      ),
    },
    {
      key: 'away',
      title: 'Clocked in away from their store',
      tone: 'bad',
      items: items(
        present
          .filter((r) => r.offSite)
          .sort(byName)
          .map((r) => {
            const e = r.clockIn as E
            const where = e?.location_label ? ` · at ${e.location_label}` : ''
            return r.flagged
              ? entry(r, `Location too rough to confirm · ${store(r)}${where}`, 'rough location')
              : entry(r, `${metres(e?.distance_m ?? null)} from ${r.outletName ?? 'their store'}${where}`, `${metres(e?.distance_m ?? null)} away`)
          }),
      ),
    },
    {
      key: 'network',
      title: 'Network trouble',
      tone: 'info',
      items: items(
        all
          .filter((r) => (r.sentLateMin ?? 0) >= NETWORK_MIN)
          .sort((a, b) => (b.sentLateMin ?? 0) - (a.sentLateMin ?? 0))
          .map((r) =>
            entry(r, `No signal at clock-in: it reached Xtend ${lateness(r.sentLateMin ?? 0)} after the photo`, `${lateness(r.sentLateMin ?? 0)} delay`),
          ),
      ),
    },
    {
      key: 'office',
      title: 'Clocked in by the office',
      tone: 'info',
      items: items(
        present
          .filter((r) => (r.clockIn as E | null)?.device_info?.source === 'office')
          .sort(byName)
          .map((r) => {
            const why = (r.clockIn as E).device_info?.reason
            const text = typeof why === 'string' && why ? why : 'Recorded by the office'
            return entry(r, text, text.length > 40 ? `${text.slice(0, 39)}…` : text)
          }),
      ),
    },
    {
      key: 'no_out',
      title: 'Did not clock out',
      tone: 'warn',
      items: items(all.filter((r) => r.missingOut).sort(byName).map((r) => entry(r, `In at ${clock(r.inMinutes)} · ${store(r)}`))),
    },
    {
      key: 'on_shift',
      title: 'Still on shift',
      tone: 'good',
      items: items([...onShift].sort(byName).map((r) => entry(r, `In at ${clock(r.inMinutes)} · ${store(r)}`))),
    },
  ].filter((x) => x.items.length) as WriteUpSection[]

  return {
    heading: single ? `How ${longDate(range.from)} went` : `How ${longDate(range.from)} to ${longDate(range.to)} went`,
    overview,
    sections,
    worry: single ? [] : concerns(all, people, 20).map((c) => c.text),
  }
}

/** The same, as text lines: "## " headings and "• " points. */
export function attendanceWriteUp<E extends Event>(all: DayRecord<E>[], people: Person[], range: { from: string; to: string }): string[] {
  const parts = writeUpParts(all, people, range)
  const lines = [`## ${parts.heading}`, ...parts.overview]
  for (const sec of parts.sections) {
    lines.push('', `## ${sec.title} (${sec.items.length})`)
    for (const it of sec.items.slice(0, MAX_NAMES)) lines.push(`• ${it.name}${it.day ? ` (${it.day})` : ''} — ${it.detail}`)
    if (sec.items.length > MAX_NAMES) lines.push(`• and ${sec.items.length - MAX_NAMES} more: see the table.`)
  }
  if (parts.worry.length) {
    lines.push('', '## Worth a look')
    for (const w of parts.worry) lines.push(`• ${w}`)
  }
  return lines
}
