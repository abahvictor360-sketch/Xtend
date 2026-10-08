import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Donut } from '@/components/admin/overview-charts'
import { LATE, ON_TIME } from '@/lib/chart-colours'
import { ScoreBars } from '@/components/admin/score-bars'
import { lagosDateString, metres } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Analytics — Xtend' }

interface Row {
  user_id: string
  full_name: string
  outlet_name: string | null
  days_present: number
  days_late: number
  days_off_site: number
  avg_distance_m: number | null
}

function defaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  return lagosDateString(d)
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireSession(['admin', 'supervisor'])
  const { from, to } = await searchParams
  const start = from || defaultFrom()
  const end = to || lagosDateString()

  const supabase = await createServerSupabase()
  const { data } = await supabase.rpc('staff_analytics', { p_from: start, p_to: end })
  const rows = (data ?? []) as Row[]

  const workingDays = Math.max(
    1,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1,
  )

  const totalPresent = rows.reduce((sum, r) => sum + r.days_present, 0)
  const totalLate = rows.reduce((sum, r) => sum + r.days_late, 0)
  const teamRate = totalPresent ? Math.round(((totalPresent - totalLate) / totalPresent) * 100) : null
  const byRate = rows
    .map((r) => ({
      key: r.user_id,
      label: r.full_name,
      value: r.days_present ? ((r.days_present - r.days_late) / r.days_present) * 100 : null,
      detail: `${r.days_present} days present, ${r.days_late} late`,
      href: `/admin/metrics/staff/${r.user_id}`,
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.label.localeCompare(b.label))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Punctuality and coverage</h1>
        <p className="text-sm text-muted-foreground">
          {start} to {end} · {workingDays} calendar days · lateness is measured against each
          outlet’s shift start
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="text-xs text-muted-foreground">
          From
          <input
            type="date"
            name="from"
            defaultValue={start}
            className="ml-2 h-9 rounded-md border border-input px-2 text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input
            type="date"
            name="to"
            defaultValue={end}
            className="ml-2 h-9 rounded-md border border-input px-2 text-sm"
          />
        </label>
        <button className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">
          Apply
        </button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Clock-ins</CardTitle>
            <CardDescription>Every day someone clocked in, on time or late</CardDescription>
          </CardHeader>
          <CardContent>
            <Donut
              parts={[
                { label: 'On time', value: totalPresent - totalLate, colour: ON_TIME },
                { label: 'Late', value: totalLate, colour: LATE },
              ]}
              centre={teamRate === null ? '—' : `${teamRate}%`}
              centreLabel="on time"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Punctuality by person</CardTitle>
            <CardDescription>Tap a name to see their X Metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreBars rows={byRate} />
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Outlet</TableHead>
              <TableHead>Days present</TableHead>
              <TableHead>Late</TableHead>
              <TableHead>Off site</TableHead>
              <TableHead>Avg distance</TableHead>
              <TableHead>Punctuality</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const onTime = row.days_present - row.days_late
              const rate = row.days_present ? Math.round((onTime / row.days_present) * 100) : null
              return (
                <TableRow key={row.user_id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/metrics/staff/${row.user_id}`} className="hover:text-brand hover:underline">
                      {row.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{row.outlet_name ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">{row.days_present}</TableCell>
                  <TableCell className="tabular-nums">{row.days_late}</TableCell>
                  <TableCell className="tabular-nums">{row.days_off_site}</TableCell>
                  <TableCell className="tabular-nums">{metres(row.avg_distance_m)}</TableCell>
                  <TableCell>
                    {rate === null ? (
                      <Badge variant="outline">No data</Badge>
                    ) : (
                      <Badge variant={rate >= 90 ? 'success' : rate >= 70 ? 'warning' : 'destructive'}>
                        {rate}%
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
