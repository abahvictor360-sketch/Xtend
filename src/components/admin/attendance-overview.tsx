import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { AlarmClock, CalendarCheck2, CircleAlert, Clock3, LogOut, MapPinOff, Phone, Route, Timer, TrendingUp, UserX } from 'lucide-react'
import { clock, lateness, percent, type Summary } from '@/lib/attendance-report'
import { cn } from '@/lib/utils'

/**
 * The Attendance page's overview, presentation only: the figures, today's
 * lists, the "worth a look" card and section headings. The page reads the
 * data (through RLS) and passes it in.
 */

type Tone = 'brand' | 'good' | 'warn' | 'bad' | 'muted'

const TONE: Record<Tone, { tile: string; bar: string; value: string }> = {
  brand: { tile: 'bg-tint text-brand', bar: 'bg-brand', value: '' },
  good: { tile: 'bg-success/10 text-success', bar: 'bg-success', value: '' },
  warn: { tile: 'bg-warning/15 text-warning', bar: 'bg-warning', value: 'text-warning' },
  bad: { tile: 'bg-destructive/10 text-destructive', bar: 'bg-destructive', value: 'text-destructive' },
  muted: { tile: 'bg-muted text-muted-foreground', bar: 'bg-muted-foreground', value: '' },
}

function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'brand',
  bar,
}: {
  icon: LucideIcon
  label: string
  value: string
  note?: string
  tone?: Tone
  /** 0–100: a thin bar under the figure. */
  bar?: number | null
}) {
  const t = TONE[tone]
  return (
    <div className="surface flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', t.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className={cn('text-3xl font-extrabold leading-none tabular-nums', t.value)}>{value}</p>
      {bar != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn('h-full rounded-full', t.bar)} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
      {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, warn }: { icon: LucideIcon; label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className={cn('h-4 w-4 shrink-0', warn ? 'text-destructive' : 'text-muted-foreground')} />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className={cn('text-base font-bold tabular-nums', warn && 'text-destructive')}>{value}</p>
      </div>
    </div>
  )
}

/** The figures for the range: four headline cards and a strip of the rest. */
export function AttendanceStats({ summary, endsToday }: { summary: Summary; endsToday: boolean }) {
  const s = summary
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={CalendarCheck2}
          label="Came in"
          value={String(s.present)}
          note={`of ${s.expected} working day${s.expected === 1 ? '' : 's'} · ${percent(s.turnout)} turned up`}
          tone="good"
          bar={s.turnout}
        />
        <StatCard
          icon={UserX}
          label={endsToday ? 'Absent or not in yet' : 'Absent'}
          value={String(s.absent)}
          note={s.absent ? 'Working days with no clock-in' : 'Nobody missing'}
          tone={s.absent ? 'bad' : 'muted'}
          bar={s.expected ? (s.absent / s.expected) * 100 : null}
        />
        <StatCard
          icon={AlarmClock}
          label="Late"
          value={String(s.late)}
          note={s.avgLateMin !== null ? `${lateness(s.avgLateMin)} late on average` : 'Nobody late'}
          tone={s.late ? 'warn' : 'muted'}
          bar={s.present ? (s.late / s.present) * 100 : null}
        />
        <StatCard
          icon={MapPinOff}
          label="Off site or flagged"
          value={String(s.offSite)}
          note={s.offSite ? 'Clocked in away from the store' : 'All at their store'}
          tone={s.offSite ? 'bad' : 'muted'}
          bar={s.present ? (s.offSite / s.present) * 100 : null}
        />
      </div>
      <div className="surface grid grid-cols-2 divide-x divide-y divide-border overflow-hidden p-0 sm:grid-cols-4 sm:divide-y-0">
        <MiniStat icon={TrendingUp} label="On time" value={percent(s.punctuality)} />
        <MiniStat icon={Clock3} label="Usual clock-in" value={clock(s.avgIn)} />
        <MiniStat
          icon={Timer}
          label="Hours on shift"
          value={s.avgHours !== null ? `${Math.round(s.avgHours * 10) / 10} h avg` : '—'}
        />
        <MiniStat icon={LogOut} label="No clock-out" value={String(s.missingOut)} warn={s.missingOut > 0} />
      </div>
    </div>
  )
}

export interface TodayItem {
  key: string
  name: string
  line: string
  team: string | null
  phone: string | null
  dayHref: string
  movementHref: string
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** "Not clocked in today" and "Late today": who, with a call and their movement. */
export function TodayPanel({
  title,
  icon: Icon,
  tone,
  items,
  empty,
  note,
}: {
  title: string
  icon: LucideIcon
  tone: Tone
  items: TodayItem[]
  empty: string
  note?: string
}) {
  const t = TONE[tone]
  return (
    <section className="surface flex min-w-0 flex-col p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', t.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums', items.length ? t.tile : 'bg-muted text-muted-foreground')}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 rounded-xl bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {items.map((r) => (
            <li key={r.key} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-brand">
                {initials(r.name)}
              </span>
              <span className="min-w-0 flex-1">
                {/* Their day, where the office can fix a clock-in that did not work (0090). */}
                <Link href={r.dayHref} className="block truncate text-sm font-semibold hover:text-brand hover:underline">
                  {r.name}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.line}
                  {r.team ? ` · ${r.team}` : ''}
                </span>
              </span>
              {r.phone && (
                <a
                  href={`tel:${r.phone}`}
                  aria-label={`Call ${r.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-brand hover:bg-tint"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
              <Link
                href={r.movementHref}
                aria-label={`${r.name}'s movement today`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-brand hover:bg-tint"
              >
                <Route className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export interface WorryItem {
  key: string
  text: string
  daysHref: string
  excuse?: { href: string; label: string }
}

/** Patterns worth a look: repeat absences, lateness, off-site clock-ins, missing clock-outs. */
export function WorthALook({ items }: { items: WorryItem[] }) {
  if (!items.length) return null
  return (
    <section className="surface border-l-4 border-l-destructive p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <CircleAlert className="h-5 w-5 text-destructive" />
        <h2 className="text-base font-bold">Worth a look</h2>
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">{items.length}</span>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {items.map((c) => (
          <li key={c.key} className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
            <p>{c.text}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
              <Link href={c.daysHref} className="text-brand hover:underline">
                See their days
              </Link>
              {c.excuse && (
                <Link href={c.excuse.href} className="text-brand hover:underline">
                  {c.excuse.label}
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A section heading with an icon, a line under it and room on the right. */
export function SectionTitle({
  icon: Icon,
  title,
  note,
  children,
  id,
}: {
  icon: LucideIcon
  title: string
  note?: string
  children?: React.ReactNode
  id?: string
}) {
  return (
    <div id={id} className="flex scroll-mt-4 flex-wrap items-end justify-between gap-2">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="text-lg font-bold leading-tight">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}
