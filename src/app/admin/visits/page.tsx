import Link from 'next/link'
import { RETENTION_DAYS } from '@/lib/retention'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { fetchCoverage, fetchVisits } from '@/lib/export/visits'
import { signSelfies } from '@/lib/export/data'
import { VisitFilters } from '@/components/admin/visit-filters'
import {
  BreakdownTable,
  Coverage,
  DayStrip,
  Figure,
  StatusBadge,
  VisitLine,
} from '@/components/admin/visit-views'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { duration } from '@/lib/movement'
import {
  SHORT_MINUTES,
  coverage,
  coverageCounts,
  movementHref,
  parseVisitFilter,
  personBreakdown,
  storeBreakdown,
  storeName,
  visitFigures,
  visitQueryString,
  worthALook,
  type Finding,
  type VisitFilter,
  type VisitRow,
  type VisitView,
} from '@/lib/visit-review'
import { formatLagos, lagosDateString, longDate } from '@/lib/utils'
import { CalendarDays, CircleAlert, Clock3, MapPin, Store, Users } from 'lucide-react'
import { Chip, EmptyState, PageHeader, SectionTitle, StatCard, StatGrid, TabLinks } from '@/components/admin/page-kit'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store visits — Xtend' }

type Search = Record<string, string | string[] | undefined>

const VIEW_LABEL: Record<VisitView, string> = {
  visits: 'Visits',
  stores: 'By store',
  people: 'By person',
  coverage: 'Store coverage',
}

export default async function VisitsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
  const parsed = parseVisitFilter(await searchParams)
  const supabase = await createServerSupabase()

  // No date given means today, which is what the office wants on open.
  const today = lagosDateString()
  const from = parsed.from && parsed.from <= today ? parsed.from : today
  const to = parsed.to && parsed.to >= from && parsed.to <= today ? parsed.to : parsed.to && parsed.to < from ? from : today
  const filter: VisitFilter & { from: string; to: string } = { ...parsed, from, to, limit: 1000 }
  const shortMinutes = filter.short ?? SHORT_MINUTES

  const [visitsGot, covGot, { data: staff }, { data: outletList }, { data: teams }, { data: dayRows }] = await Promise.all([
    filter.view === 'coverage'
      ? Promise.resolve({ rows: [] as VisitRow[], error: null })
      : fetchVisits(supabase, filter)
          .then((rows) => ({ rows, error: null as string | null }))
          .catch((e: Error) => ({ rows: [] as VisitRow[], error: e.message })),
    fetchCoverage(supabase),
    supabase.from('profiles').select('id, full_name').in('role', ['merchandiser', 'marketer']).order('full_name'),
    supabase.from('outlets').select('id, name').order('name'),
    isAdmin
      ? supabase.from('profiles').select('id, full_name').eq('role', 'supervisor').eq('is_active', true).order('full_name')
      : Promise.resolve({ data: null }),
    // The bookends of the day. Only meaningful for a single date.
    from === to && filter.view === 'visits' ? supabase.rpc('staff_day', { p_date: from }) : Promise.resolve({ data: null }),
  ])
  const visits = visitsGot.rows

  interface Day {
    user_id: string
    staff_name: string
    clocked_in_at: string | null
    clocked_out_at: string | null
    still_in_store: string | null
  }
  const days = new Map<string, Day>(((dayRows ?? []) as Day[]).map((d) => [d.user_id, d]))

  const figures = visitFigures(visits, shortMinutes)
  const findings = worthALook(visits, shortMinutes)
  const covered = coverage(covGot.rows, today, isAdmin)
  const covCounts = coverageCounts(covered)
  const ranged = from !== to
  const inStore = to === today ? visits.filter((v) => !v.departed_at) : []
  const href = (over: Partial<VisitFilter>) => `?${visitQueryString({ ...filter, ...over })}`

  // Clock photos are kept for 14 days (0067), and announced a night before
  // they go; only those can still be shown.
  const recent = Date.now() - (RETENTION_DAYS + 2) * 86_400_000
  const selfies =
    filter.view === 'visits'
      ? await signSelfies(
          supabase,
          visits
            .filter((v) => Date.parse(v.arrived_at) > recent)
            .flatMap((v) => [v.selfie_path, v.departed_selfie_path ?? null])
            .filter(Boolean),
        )
      : new Map<string, string>()

  const byPerson = new Map<string, VisitRow[]>()
  for (const visit of visits) byPerson.set(visit.user_id, [...(byPerson.get(visit.user_id) ?? []), visit])
  const flagsOf = new Map<string, Finding[]>()
  for (const f of findings) flagsOf.set(f.visitId, [...(flagsOf.get(f.visitId) ?? []), f])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Store visits"
        note={
          filter.view === 'coverage'
            ? 'Every store and when somebody last visited it, longest first.'
            : 'Who worked which stores, for how long, with where they checked in and out. Lagos time.'
        }
        chips={
          <>
            <Chip icon={CalendarDays}>{ranged ? `${longDate(from)} to ${longDate(to)}` : from === today ? `Today, ${longDate(from)}` : longDate(from)}</Chip>
            {filter.view !== 'coverage' && <Chip icon={Users}>{figures.people} {figures.people === 1 ? 'person' : 'people'}</Chip>}
          </>
        }
      />

      <section className="surface p-4 sm:p-5">
        <VisitFilters filter={filter} staff={staff ?? []} outlets={outletList ?? []} teams={teams ?? null} today={today} />
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold hover:text-foreground">How visits are read</summary>
          <p className="mt-1.5 leading-relaxed">
            Tap a visit for where they checked in and out, with both photos. Very short visits, check-ins away from the
            store and trips between stores too fast to be real are called out. Download the same list as Excel, PDF, Word
            or CSV.
          </p>
        </details>
      </section>

      {visitsGot.error && <Alert variant="destructive">Could not load the visits: {visitsGot.error}</Alert>}

      {filter.view !== 'coverage' && (
        <div className="space-y-3">
        <StatGrid>
          <StatCard icon={MapPin} label="Visits" value={String(figures.visits)} note={visits.length >= 1000 ? 'Newest 1,000 shown' : 'Store check-ins'} />
          <StatCard icon={Store} label="Stores covered" value={String(figures.stores)} tone="good" note="Visited at least once" />
          <StatCard icon={Users} label="People" value={String(figures.people)} note="Who checked in" />
          <StatCard
            icon={Clock3}
            label="Average time in a store"
            value={figures.averageMinutes != null ? duration(figures.averageMinutes) : '—'}
            note={figures.minutes ? `${duration(figures.minutes)} in all` : 'No time recorded'}
          />
        </StatGrid>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure
            label={`Shorter than ${shortMinutes} min`}
            value={String(figures.short)}
            warn={figures.short > 0}
            href={figures.short && !filter.short ? href({ short: shortMinutes }) : undefined}
          />
          <Figure
            label="Arrived away from the store"
            value={String(figures.offSite)}
            warn={figures.offSite > 0}
            href={figures.offSite && filter.status !== 'off_site' ? href({ status: 'off_site' }) : undefined}
          />
          <Figure label={to === today ? 'In a store now' : 'Rough location on arrival'} value={String(to === today ? inStore.length : figures.rough)} />
          <Figure
            label="Stores not visited in 7+ days"
            value={covGot.error ? '—' : String(covCounts.over7)}
            warn={covCounts.over7 > 0}
            href={covGot.error ? undefined : href({ view: 'coverage', gap: 7 })}
          />
        </div>
        </div>
      )}

      {filter.view !== 'coverage' && findings.length > 0 && (
        <section className="surface border-l-4 border-l-destructive p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <CircleAlert className="h-5 w-5 text-destructive" />
            <h2 className="text-base font-bold">Worth a look</h2>
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">{findings.length}</span>
          </div>
          <ul className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            {findings.slice(0, 8).map((f, i) => (
              <li key={`${f.visitId}-${f.kind}-${i}`} className="rounded-xl bg-muted/40 px-3 py-2.5">
                <span className="font-semibold">{f.name}</span>
                {ranged ? ` (${f.date})` : ''} {f.text}.{' '}
                <Link href={movementHref(f.userId, f.date)} className="font-semibold text-brand hover:underline">
                  Movement that day
                </Link>
              </li>
            ))}
          </ul>
          {findings.length > 8 && (
            <p className="mt-2 text-xs text-muted-foreground">
              And {findings.length - 8} more, marked on the visits below and in the download.
            </p>
          )}
        </section>
      )}

      <TabLinks
        tabs={(Object.keys(VIEW_LABEL) as VisitView[]).map((v) => ({
          href: href({ view: v, gap: v === 'coverage' ? filter.gap : null }),
          label: VIEW_LABEL[v],
          active: filter.view === v,
        }))}
      />

      {filter.view === 'visits' && (
        <>
          {inStore.length > 0 && (
            <section className="surface space-y-3 p-4 sm:p-5">
              <SectionTitle icon={Store} tone="good" title={`In a store right now (${inStore.length})`} note="Checked in and not yet checked out." />
                <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
                  {inStore.map((visit) => (
                    <li key={visit.id} className="flex items-center justify-between gap-3 border-t border-border py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{visit.staff_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {storeName(visit)} · since {formatLagos(visit.arrived_at, false)} · {duration(visit.minutes)}
                        </span>
                      </span>
                      <StatusBadge status={visit.arrived_status} />
                    </li>
                  ))}
                </ul>
            </section>
          )}

          {visits.length === 0 ? (
            <EmptyState icon={MapPin}>No store visits recorded for that period.</EmptyState>
          ) : (
            [...byPerson.values()].map((rows) => {
              const first = rows[0]
              const flagged = rows.filter((v) => flagsOf.has(v.id)).length
              return (
                <section key={first.user_id} className="surface min-w-0 space-y-3 p-4 sm:p-5">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-brand">
                          {first.staff_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
                        </span>
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-bold">{first.staff_name}</h2>
                          <p className="text-xs text-muted-foreground">
                            {rows.length} visit{rows.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      <span className="flex flex-wrap gap-3 text-xs font-semibold">
                        {flagged > 0 && <Badge variant="destructive">{flagged} worth a look</Badge>}
                        <Link href={movementHref(first.user_id, from, to)} className="text-brand hover:underline">
                          Movement
                        </Link>
                        {!filter.user_id && (
                          <Link href={href({ user_id: first.user_id })} className="text-brand hover:underline">
                            Only {first.staff_name.split(' ')[0]}
                          </Link>
                        )}
                      </span>
                    </div>
                    <DayStrip
                      day={ranged ? undefined : days.get(first.user_id)}
                      stores={new Set(rows.map((r) => r.outlet_id ?? r.store_label)).size}
                      minutes={rows.reduce((total, r) => total + r.minutes, 0)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((visit) => (
                      <VisitLine
                        key={visit.id}
                        visit={visit}
                        ranged={ranged}
                        flags={flagsOf.get(visit.id) ?? []}
                        selfie={visit.selfie_path ? (selfies.get(visit.selfie_path) ?? null) : null}
                        leftSelfie={visit.departed_selfie_path ? (selfies.get(visit.departed_selfie_path) ?? null) : null}
                      />
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </>
      )}

      {(filter.view === 'stores' || filter.view === 'people') && (
        <BreakdownTable
          kind={filter.view}
          rows={filter.view === 'stores' ? storeBreakdown(visits, shortMinutes) : personBreakdown(visits, shortMinutes)}
          shortMinutes={shortMinutes}
          ranged={ranged}
          from={from}
          to={to}
          href={href}
        />
      )}

      {filter.view === 'coverage' &&
        (covGot.error ? (
          <Alert variant="destructive">{covGot.error}</Alert>
        ) : (
          <Coverage rows={covered} counts={covCounts} gap={filter.gap} href={href} isAdmin={isAdmin} />
        ))}
    </div>
  )
}

