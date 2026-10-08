import Link from 'next/link'
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
  chip,
} from '@/components/admin/visit-views'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { formatLagos, lagosDateString } from '@/lib/utils'

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

  // Clock photos are kept for 24 hours; only those can still be shown.
  const recent = Date.now() - 26 * 3_600_000
  const selfies =
    filter.view === 'visits'
      ? await signSelfies(supabase, visits.filter((v) => Date.parse(v.arrived_at) > recent).map((v) => v.selfie_path))
      : new Map<string, string>()

  const byPerson = new Map<string, VisitRow[]>()
  for (const visit of visits) byPerson.set(visit.user_id, [...(byPerson.get(visit.user_id) ?? []), visit])
  const flagsOf = new Map<string, Finding[]>()
  for (const f of findings) flagsOf.set(f.visitId, [...(flagsOf.get(f.visitId) ?? []), f])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store visits</h1>
        <p className="text-sm text-muted-foreground">
          {filter.view === 'coverage'
            ? 'Every store and when somebody last visited it, longest first.'
            : `${ranged ? `${from} to ${to}` : from === today ? 'Today' : from}, Africa/Lagos. When each person clocked in, the stores they worked and for how long, and when they clocked out.`}{' '}
          Tap a visit for where they checked in and out. Very short visits, check-ins away from the store and trips
          between stores too fast to be real are called out. Download the same list as Excel, PDF, Word or CSV.
        </p>
      </div>

      <VisitFilters filter={filter} staff={staff ?? []} outlets={outletList ?? []} teams={teams ?? null} today={today} />

      {visitsGot.error && <Alert variant="destructive">Could not load the visits: {visitsGot.error}</Alert>}

      {filter.view !== 'coverage' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label="Visits" value={String(figures.visits)} note={visits.length >= 1000 ? 'newest 1,000 shown' : undefined} />
          <Figure label="Stores covered" value={String(figures.stores)} />
          <Figure label="People" value={String(figures.people)} />
          <Figure
            label="Average time in a store"
            value={figures.averageMinutes != null ? duration(figures.averageMinutes) : '—'}
            note={figures.minutes ? `${duration(figures.minutes)} in all` : undefined}
          />
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
      )}

      {filter.view !== 'coverage' && findings.length > 0 && (
        <Alert variant="destructive">
          <p className="font-semibold">Worth a look ({findings.length})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {findings.slice(0, 8).map((f, i) => (
              <li key={`${f.visitId}-${f.kind}-${i}`}>
                <span className="font-semibold">{f.name}</span>
                {ranged ? ` (${f.date})` : ''} {f.text}.{' '}
                <Link href={movementHref(f.userId, f.date)} className="underline">
                  Movement that day
                </Link>
              </li>
            ))}
          </ul>
          {findings.length > 8 && (
            <p className="mt-1 text-xs text-muted-foreground">
              And {findings.length - 8} more, marked on the visits below and in the download.
            </p>
          )}
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(VIEW_LABEL) as VisitView[]).map((v) => (
          <Link
            key={v}
            href={href({ view: v, gap: v === 'coverage' ? filter.gap : null })}
            aria-current={filter.view === v ? 'page' : undefined}
            className={chip(filter.view === v)}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </div>

      {filter.view === 'visits' && (
        <>
          {inStore.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>In a store right now</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {inStore.map((visit) => (
                    <li key={visit.id} className="flex items-center justify-between gap-3 py-2">
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
              </CardContent>
            </Card>
          )}

          {visits.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No store visits recorded for that period.
            </p>
          ) : (
            [...byPerson.values()].map((rows) => {
              const first = rows[0]
              const flagged = rows.filter((v) => flagsOf.has(v.id)).length
              return (
                <Card key={first.user_id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <CardTitle>{first.staff_name}</CardTitle>
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
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {rows.map((visit) => (
                      <VisitLine
                        key={visit.id}
                        visit={visit}
                        ranged={ranged}
                        flags={flagsOf.get(visit.id) ?? []}
                        selfie={visit.selfie_path ? (selfies.get(visit.selfie_path) ?? null) : null}
                      />
                    ))}
                  </CardContent>
                </Card>
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

