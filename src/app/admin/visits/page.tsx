import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { fetchVisits, visitSummary, type VisitFilter } from '@/lib/export/visits'
import { VisitFilters } from '@/components/admin/visit-filters'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatLagos, metres } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store visits — Xtend' }

type Search = Record<string, string | string[] | undefined>

function one(search: Search, key: string) {
  const value = search[key]
  const single = Array.isArray(value) ? value[0] : value
  return single && single !== 'all' ? single : null
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'on_site') return <Badge variant="success">On site</Badge>
  if (status === 'off_site') return <Badge variant="destructive">Off site</Badge>
  if (status === 'flagged') return <Badge variant="warning">Flagged</Badge>
  return <Badge variant="outline">—</Badge>
}

export default async function VisitsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const supabase = await createServerSupabase()

  // No date given means today, which is what the office wants on open.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  const from = one(search, 'from') ?? today
  const to = one(search, 'to') ?? today

  const filter: VisitFilter = {
    from,
    to,
    user_id: one(search, 'user_id'),
    outlet_id: one(search, 'outlet_id'),
    status: one(search, 'status'),
    limit: 1000,
  }

  const [visits, { data: staff }, { data: outletList }] = await Promise.all([
    fetchVisits(supabase, filter),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('outlets').select('id, name').order('name'),
  ])

  const summary = visitSummary(visits)
  const ranged = from !== to

  const byPerson = new Map<string, typeof visits>()
  for (const visit of visits) {
    byPerson.set(visit.staff_name, [...(byPerson.get(visit.staff_name) ?? []), visit])
  }

  const inStore = visits.filter((v) => v.status === 'open')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store visits</h1>
        <p className="text-sm text-muted-foreground">
          {ranged ? `${from} to ${to}` : 'Today'}, Africa/Lagos. A marketer checks in at a store,
          works, and checks out before moving on — each row is one visit. Download the same rounds
          as PDF, Word or Excel.
        </p>
      </div>

      <VisitFilters staff={staff ?? []} outlets={outletList ?? []} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="stat">
          <p className="stat-label">Visits</p>
          <p className="stat-value">{visits.length}</p>
        </div>
        <div className="stat">
          <p className="stat-label">{ranged ? 'Stores covered' : 'In store now'}</p>
          <p className="stat-value text-success">{ranged ? summary.stores : inStore.length}</p>
        </div>
        <div className="stat">
          <p className="stat-label">Staff out</p>
          <p className="stat-value">{summary.people}</p>
        </div>
        <div className="stat">
          <p className="stat-label">Arrived off site</p>
          <p className="stat-value text-destructive">{summary.offSite}</p>
        </div>
      </div>

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
                      {visit.outlet_name} · since {formatLagos(visit.arrived_at, false)} ·{' '}
                      {visit.minutes} min
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
        Array.from(byPerson.entries()).map(([name, rows]) => (
          <Card key={name}>
            <CardHeader>
              <CardTitle>
                {name}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  — {rows.length} store{rows.length === 1 ? '' : 's'},{' '}
                  {rows.reduce((total, r) => total + r.minutes, 0)} min in store
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store</TableHead>
                      <TableHead>In</TableHead>
                      <TableHead>Out</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Arrived</TableHead>
                      <TableHead>Left</TableHead>
                      <TableHead>Where they checked in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((visit) => (
                      <TableRow key={visit.id}>
                        <TableCell className="font-medium">{visit.outlet_name}</TableCell>
                        <TableCell className="tabular-nums">
                          {ranged && (
                            <span className="mr-1 text-xs text-muted-foreground">
                              {visit.visit_date}
                            </span>
                          )}
                          {formatLagos(visit.arrived_at, false)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {visit.departed_at ? (
                            formatLagos(visit.departed_at, false)
                          ) : (
                            <Badge variant="brand">Still there</Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">{visit.minutes} min</TableCell>
                        <TableCell>
                          <StatusBadge status={visit.arrived_status} />
                          <span className="ml-1 text-xs text-muted-foreground">
                            {metres(visit.arrived_distance_m)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {visit.departed_at ? (
                            <>
                              <StatusBadge status={visit.departed_status} />
                              <span className="ml-1 text-xs text-muted-foreground">
                                {metres(visit.departed_distance_m)}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                          {visit.arrived_label ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Phone */}
              <ul className="divide-y divide-border md:hidden">
                {rows.map((visit) => (
                  <li key={visit.id} className="space-y-1 py-3">
                    <p className="flex items-center justify-between gap-2 text-sm font-semibold">
                      {visit.outlet_name}
                      {visit.departed_at ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {visit.minutes} min
                        </span>
                      ) : (
                        <Badge variant="brand">Still there</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ranged && `${visit.visit_date} · `}
                      {formatLagos(visit.arrived_at, false)}
                      {visit.departed_at && ` – ${formatLagos(visit.departed_at, false)}`} ·{' '}
                      {metres(visit.arrived_distance_m)} from door
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{visit.arrived_label}</p>
                    <StatusBadge status={visit.arrived_status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
