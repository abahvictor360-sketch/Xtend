import Link from 'next/link'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { IntegrityFlags } from '@/components/admin/integrity-flags'
import { KindBars, RiskList, Stat, Trend } from '@/components/admin/integrity-overview'
import { AREA_LABEL, FLAG_AREAS, FLAG_KINDS, flagArea } from '@/lib/integrity'
import {
  MAX_DAYS,
  SEVERITIES,
  SEVERITY_LABEL,
  applyIntegrityFilter,
  countBy,
  fetchIntegrity,
  flagsPerDay,
  integrityQueryString,
  kindLabel,
  parseIntegrityFilter,
  personRisk,
  type FlagRow,
  type IntegrityFilter,
} from '@/lib/integrity-review'
import { addDays, cn, lagosDateString, longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Integrity checks — Xtend' }

export default async function IntegrityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const today = lagosDateString()
  const filter = parseIntegrityFilter(await searchParams, today)
  const supabase = await createServerSupabase()

  // RLS narrows every one of these to a supervisor's own team; an admin sees everyone.
  const [{ data: people }, { data: stores }, got] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('role', FIELD_ROLES).order('full_name'),
    supabase.from('outlets').select('id, name').order('name'),
    fetchIntegrity(supabase, filter).catch((e: Error) => ({ error: e.message })),
  ])
  const failed = 'error' in got ? got.error : null
  const all: FlagRow[] = 'rows' in got ? got.rows : []
  const truncated = 'truncated' in got && got.truncated
  const shown = applyIntegrityFilter(all, filter)

  const open = all.filter((f) => !f.reviewed_at)
  const highOpen = open.filter((f) => f.severity === 'high').length
  const reviewed = all.length - open.length
  const risk = personRisk(all, today)
  const byKind = countBy(all, (f) => f.kind)
  const perDay = flagsPerDay(all, filter.from, filter.to)
  const query = integrityQueryString(filter)
  const href = (change: Partial<IntegrityFilter>) => `?${integrityQueryString({ ...filter, ...change })}`
  const monthStart = `${today.slice(0, 8)}01`

  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'This month', from: monthStart, to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'Last 90 days', from: addDays(today, -89), to: today },
  ]
  const kindsByArea = (Object.keys(FLAG_AREAS) as (keyof typeof FLAG_AREAS)[]).map((area) => ({
    area,
    kinds: Object.keys(FLAG_KINDS).filter((k) => flagArea(k) === area),
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Integrity checks</h1>
        <p className="text-sm text-muted-foreground">
          Things that look wrong: signs of a fake-location app, phone clocks changed, photos refused, and stock counts
          that do not add up. A flag is a reason to look, not proof. See who to look at first, open a flag for the
          detail and the evidence around it, then mark it reviewed with what you found, one at a time or several
          together.{session.profile.role === 'supervisor' ? ' You see your own team only.' : ''} Staff do not see
          these.
        </p>
      </div>

      <form method="get" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={filter.from} max={today} className="h-10 w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={filter.to} max={today} className="h-10 w-40" />
          </div>
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="person">Who</Label>
            <Select id="person" name="person" defaultValue={filter.person ?? 'all'} className="h-10 text-sm">
              <option value="all">Everyone</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="store">Store</Label>
            <Select id="store" name="store" defaultValue={filter.store ?? 'all'} className="h-10 text-sm">
              <option value="all">Every store</option>
              {(stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-56">
            <Label htmlFor="kind">Check</Label>
            <Select id="kind" name="kind" defaultValue={filter.kind ?? 'all'} className="h-10 text-sm">
              <option value="all">Every check</option>
              {kindsByArea.map(({ area, kinds }) => (
                <optgroup key={area} label={AREA_LABEL[area]}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div className="w-[calc(50%-0.375rem)] space-y-1.5 sm:w-36">
            <Label htmlFor="severity">Severity</Label>
            <Select id="severity" name="severity" defaultValue={filter.severity ?? 'all'} className="h-10 text-sm">
              <option value="all">Any</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[calc(50%-0.375rem)] space-y-1.5 sm:w-40">
            <Label htmlFor="status">Show</Label>
            <Select id="status" name="status" defaultValue={filter.status} className="h-10 text-sm">
              <option value="open">To review</option>
              <option value="reviewed">Reviewed</option>
              <option value="all">All</option>
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={filter.q ?? ''} placeholder="Name, store, note…" className="h-10" />
          </div>
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Show
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
          {presets.map((p) => (
            <Link
              key={p.label}
              href={href({ from: p.from, to: p.to })}
              className={cn(
                'rounded-full border px-3 py-1 font-semibold hover:border-brand hover:bg-tint',
                p.from === filter.from && p.to === filter.to ? 'border-brand bg-tint' : 'border-border bg-card',
              )}
            >
              {p.label}
            </Link>
          ))}
          <Link href="/admin/integrity" className="px-2 py-1 font-semibold text-muted-foreground hover:text-foreground">
            Clear
          </Link>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Download:</span>
            {(['xlsx', 'pdf', 'docx', 'csv'] as const).map((f) => (
              <a
                key={f}
                href={`/api/admin/export/integrity/${f}?${query}`}
                className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                {{ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' }[f]}
              </a>
            ))}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {longDate(filter.from)}
          {filter.to !== filter.from ? ` to ${longDate(filter.to)}` : ''} · up to {MAX_DAYS} days at a time
          {truncated ? ' · only the newest 2,000 flags are shown: narrow the dates' : ''}
        </p>
      </form>

      {failed && (
        <p className="text-sm text-destructive">The checks could not be loaded: {failed}. Has migration 022 been run in Supabase?</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="To review" value={open.length} note={`of ${all.length} in these dates`} tone={open.length ? 'warn' : undefined} />
        <Stat label="High, not reviewed" value={highOpen} tone={highOpen ? 'bad' : undefined} />
        <Stat
          label="People with open flags"
          value={risk.length}
          note={risk.filter((p) => p.level === 'act').length ? `${risk.filter((p) => p.level === 'act').length} to act on now` : undefined}
        />
        <Stat label="Reviewed" value={reviewed} note={all.length ? `${Math.round((reviewed / all.length) * 100)}% done` : undefined} />
      </div>

      {all.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Who to look at first</CardTitle>
              <CardDescription>
                People ranked by open flags: high counts most, the last 7 days count double, and proof from the phone
                (fake GPS confirmed, a tampered phone, a faked clock time) puts them straight to the top.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {risk.length === 0 ? (
                <p className="text-sm text-muted-foreground">Everything in these dates has been reviewed.</p>
              ) : (
                <RiskList risk={risk.slice(0, 8)} filter={filter} />
              )}
              {risk.length > 8 && (
                <p className="mt-2 text-xs text-muted-foreground">And {risk.length - 8} more with fewer flags.</p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Flags per day</CardTitle>
                <CardDescription>Every flag in these dates, reviewed or not, by severity.</CardDescription>
              </CardHeader>
              <CardContent>
                <Trend days={perDay} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By check</CardTitle>
                <CardDescription>Tap one to see only those.</CardDescription>
              </CardHeader>
              <CardContent>
                <KindBars kinds={byKind} active={filter.kind} href={(kind) => href({ kind })} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            {filter.status === 'open' ? 'To review' : filter.status === 'reviewed' ? 'Reviewed' : 'All flags'}
          </h2>
          {filter.kind && <Badge>{kindLabel(filter.kind)}</Badge>}
          {filter.severity && <Badge>{SEVERITY_LABEL[filter.severity]}</Badge>}
          {filter.person && <Badge>{(people ?? []).find((p) => p.id === filter.person)?.full_name ?? 'One person'}</Badge>}
          {filter.store && <Badge>{(stores ?? []).find((s) => s.id === filter.store)?.name ?? 'One store'}</Badge>}
          <span className="ml-auto flex gap-1.5 text-xs">
            {(['open', 'reviewed', 'all'] as const).map((s) => (
              <Link
                key={s}
                href={href({ status: s })}
                className={cn(
                  'rounded-full border px-3 py-1 font-semibold hover:border-brand hover:bg-tint',
                  filter.status === s ? 'border-brand bg-tint' : 'border-border bg-card',
                )}
              >
                {{ open: `To review (${open.length})`, reviewed: `Reviewed (${reviewed})`, all: `All (${all.length})` }[s]}
              </Link>
            ))}
          </span>
        </div>
        {!failed && <IntegrityFlags flags={shown} status={filter.status} />}
      </div>
    </div>
  )
}
