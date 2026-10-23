import Link from 'next/link'
import { Activity, LogIn, Smartphone, Trophy } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ACTIVITY_GROUPS,
  activityPresets,
  activityQueryString,
  detailText,
  deviceText,
  groupByDay,
  kindGroup,
  lagosDay,
  perPerson,
  personLinks,
  platformLabel,
  roleLabel,
  summarise,
  type ActivityFilter,
  type ActivityRow,
} from '@/lib/activity-log'
import { cn, formatLagos } from '@/lib/utils'

/** How each kind of activity is marked in the timeline. */
const DOT: Record<string, string> = {
  signin: 'bg-[#52281a]',
  app: 'bg-[#f2b48a]',
  clock: 'bg-[#d1511a]',
  visits: 'bg-[#e8833a]',
  work: 'bg-[#9b3517]',
  leave: 'bg-[#e8833a]',
  support: 'bg-[#9b3517]',
  account: 'bg-[#52281a]',
}

export function ActivityView({
  filter,
  rows,
  truncated,
  people,
  failed,
  today,
}: {
  filter: ActivityFilter
  rows: ActivityRow[]
  truncated: boolean
  people: { id: string; full_name: string; role: string }[]
  failed: string | null
  today: string
}) {
  const summary = summarise(rows)
  const byPerson = perPerson(rows)
  const days = groupByDay(rows)
  const query = activityQueryString(filter)
  const presets = activityPresets(today).map((p) => ({
    ...p,
    active: p.from === filter.from && p.to === filter.to,
    href: `?${activityQueryString({ ...filter, from: p.from, to: p.to })}`,
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          What everyone does in Xtend — staff, supervisors and admins — newest first, in Lagos time: signing in and out,
          opening the app, clocking in and out, store visits, reports, counts, leave and support messages, with the device
          and IP address where known. Only admins can see this page.
        </p>
      </div>

      <form method="get" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-56">
            <Label htmlFor="person">Who</Label>
            <Select id="person" name="person" defaultValue={filter.person ?? 'all'} className="h-11 text-sm">
              <option value="all">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({roleLabel(p.role)})
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="group">What</Label>
            <Select id="group" name="group" defaultValue={filter.group ?? 'all'} className="h-11 text-sm">
              <option value="all">All activity</option>
              {Object.entries(ACTIVITY_GROUPS).map(([key, g]) => (
                <option key={key} value={key}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={filter.from} max={today} className="h-11 w-full sm:w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={filter.to} max={today} className="h-11 w-full sm:w-40" />
            </div>
          </div>
          <button type="submit" className={buttonVariants({ className: 'h-11 w-full sm:w-auto' })}>
            Show
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
          {presets.map((p) => (
            <Link
              key={p.label}
              href={p.href}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3 font-semibold',
                p.active ? 'border-brand bg-brand text-white' : 'border-border bg-card hover:border-brand hover:bg-tint',
              )}
            >
              {p.label}
            </Link>
          ))}
          {(filter.person || filter.group || filter.from !== today || filter.to !== today) && (
            <Link href="/admin/activity" className="inline-flex min-h-11 items-center px-2 font-semibold text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
          <span className="flex w-full flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto">
            <span className="font-semibold text-muted-foreground">Download:</span>
            {(['xlsx', 'pdf', 'docx', 'csv'] as const).map((f) => (
              <a
                key={f}
                href={`/api/admin/export/activity/${f}?${query}`}
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 font-semibold hover:border-brand hover:bg-tint"
              >
                {{ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' }[f]}
              </a>
            ))}
          </span>
        </div>
      </form>

      {failed && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{failed}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Activity} label="People active" value={String(summary.people)} note={`${summary.actions} action${summary.actions === 1 ? '' : 's'} in all`} />
        <Stat icon={LogIn} label="Sign-ins" value={String(summary.signIns)} />
        <Stat icon={Smartphone} label="App opens" value={String(summary.appOpens)} note="At most one per 30 minutes" />
        <Stat
          icon={Trophy}
          label="Most active"
          value={summary.mostActive?.name ?? '—'}
          note={summary.mostActive ? `${summary.mostActive.count} entr${summary.mostActive.count === 1 ? 'y' : 'ies'}` : undefined}
          small
        />
      </div>
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the newest {rows.length.toLocaleString('en-NG')} entries. Pick fewer days or one person to see the rest.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>By person</CardTitle>
          <CardDescription>Busiest first. Actions are everything except signing in and out and opening the app.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-5">
          {byPerson.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground sm:px-0">Nobody did anything in these days.</p>
          ) : (
            <>
              <ul className="divide-y divide-border sm:hidden">
                {byPerson.map((p) => {
                  const links = personLinks(p.user_id, filter.from, filter.to)
                  return (
                    <li key={p.user_id} className="space-y-1.5 px-5 py-3 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link href={`?${activityQueryString({ ...filter, person: p.user_id })}`} className="min-w-0 truncate font-semibold hover:text-brand">
                          {p.full_name}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">{roleLabel(p.role)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatLagos(p.first)} to {formatLagos(p.last, lagosDay(p.first) !== lagosDay(p.last))}
                      </p>
                      <p className="text-xs">
                        <b>{p.signIns}</b> sign-in{p.signIns === 1 ? '' : 's'} · <b>{p.appOpens}</b> app open{p.appOpens === 1 ? '' : 's'} ·{' '}
                        <b>{p.actions}</b> action{p.actions === 1 ? '' : 's'}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">{deviceText({ device: p.lastDevice, platform: p.lastPlatform })}</p>
                      <PersonLinks {...links} />
                    </li>
                  )
                })}
              </ul>
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>First</TableHead>
                      <TableHead>Last</TableHead>
                      <TableHead><span className="block text-right">Sign-ins</span></TableHead>
                      <TableHead><span className="block text-right">App opens</span></TableHead>
                      <TableHead><span className="block text-right">Actions</span></TableHead>
                      <TableHead>Last device</TableHead>
                      <TableHead>See</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byPerson.map((p) => (
                      <TableRow key={p.user_id}>
                        <TableCell>
                          <Link href={`?${activityQueryString({ ...filter, person: p.user_id })}`} className="font-semibold hover:text-brand">
                            {p.full_name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{roleLabel(p.role)}</p>
                        </TableCell>
                        <TableCell><span className="whitespace-nowrap tabular-nums">{formatLagos(p.first)}</span></TableCell>
                        <TableCell><span className="whitespace-nowrap tabular-nums">{formatLagos(p.last)}</span></TableCell>
                        <TableCell><span className="block text-right tabular-nums">{p.signIns}</span></TableCell>
                        <TableCell><span className="block text-right tabular-nums">{p.appOpens}</span></TableCell>
                        <TableCell><span className="block text-right font-semibold tabular-nums">{p.actions}</span></TableCell>
                        <TableCell>
                          <p className="max-w-[16rem] truncate">{p.lastDevice ?? 'Unknown device'}</p>
                          <p className="text-xs text-muted-foreground">
                            {[platformLabel(p.lastPlatform), p.lastIp].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </TableCell>
                        <TableCell>
                          <PersonLinks {...personLinks(p.user_id, filter.from, filter.to)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-base font-bold">Timeline</h2>
        {days.length === 0 && !failed && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">Nothing matches.</CardContent>
          </Card>
        )}
        {days.map((d) => (
          <section key={d.day} className="space-y-2">
            <h3 className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-background/95 py-1 text-sm font-semibold backdrop-blur">
              <span>{d.title}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {d.rows.length} entr{d.rows.length === 1 ? 'y' : 'ies'}
              </span>
            </h3>
            <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {d.rows.map((r, i) => {
                const detail = detailText(r)
                const links = personLinks(r.user_id, d.day, d.day)
                return (
                  <li key={`${r.at}-${r.user_id}-${r.kind}-${i}`} className="flex gap-3 p-3 text-sm">
                    <div className="w-11 shrink-0 pt-0.5 tabular-nums text-muted-foreground">
                      {formatLagos(r.at, false)}
                    </div>
                    <span aria-hidden className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', DOT[kindGroup(r.kind) ?? ''] ?? 'bg-[#f6e4d8]')} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p>
                        <Link href={`?${activityQueryString({ ...filter, person: r.user_id })}`} className="font-semibold hover:text-brand">
                          {r.full_name}
                        </Link>{' '}
                        <span className="text-xs text-muted-foreground">({roleLabel(r.role)})</span>
                      </p>
                      <p className="break-words">
                        {r.label}
                        {detail && <span className="text-muted-foreground"> · {detail}</span>}
                      </p>
                      {(r.device || r.platform || r.ip) && (
                        <p className="break-words text-xs text-muted-foreground">
                          {[r.device || r.platform ? deviceText(r) : null, r.ip ? `IP ${r.ip}` : null].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="hidden shrink-0 sm:block">
                      <PersonLinks {...links} />
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}

function PersonLinks({ movement, attendance }: { movement: string; attendance: string }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
      <Link href={movement} className="text-brand hover:underline">
        Movement
      </Link>
      <Link href={attendance} className="text-brand hover:underline">
        Attendance
      </Link>
    </span>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
  small,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  note?: string
  small?: boolean
}) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-brand" />
          {label}
        </p>
        <p className={cn('font-semibold tabular-nums', small ? 'truncate text-base leading-8' : 'text-2xl')}>{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  )
}
