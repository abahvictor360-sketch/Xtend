import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatLagos, metres } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Store visits — Xtend' }

interface VisitDetail {
  id: string
  user_id: string
  staff_name: string
  outlet_name: string
  visit_date: string
  status: 'open' | 'closed' | 'abandoned'
  arrived_at: string
  departed_at: string | null
  minutes: number
  arrived_status: string | null
  departed_status: string | null
  arrived_distance_m: number | null
  departed_distance_m: number | null
  arrived_label: string | null
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'on_site') return <Badge variant="success">On site</Badge>
  if (status === 'off_site') return <Badge variant="destructive">Off site</Badge>
  if (status === 'flagged') return <Badge variant="warning">Flagged</Badge>
  return <Badge variant="outline">—</Badge>
}

export default async function VisitsPage() {
  await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  const { data } = await supabase.rpc('store_visits_today')
  const visits = (data ?? []) as VisitDetail[]

  const byPerson = new Map<string, VisitDetail[]>()
  for (const visit of visits) {
    byPerson.set(visit.staff_name, [...(byPerson.get(visit.staff_name) ?? []), visit])
  }

  const inStore = visits.filter((v) => v.status === 'open')
  const offSite = visits.filter((v) => v.arrived_status !== 'on_site')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Store visits</h1>
        <p className="text-sm text-muted-foreground">
          Today, Africa/Lagos. A marketer checks in at a store, works, and checks out before
          moving on — each row is one visit.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="stat">
          <p className="stat-label">Visits today</p>
          <p className="stat-value">{visits.length}</p>
        </div>
        <div className="stat">
          <p className="stat-label">In store now</p>
          <p className="stat-value text-success">{inStore.length}</p>
        </div>
        <div className="stat">
          <p className="stat-label">Marketers out</p>
          <p className="stat-value">{byPerson.size}</p>
        </div>
        <div className="stat">
          <p className="stat-label">Arrived off site</p>
          <p className="stat-value text-destructive">{offSite.length}</p>
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
          No store visits recorded today.
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
