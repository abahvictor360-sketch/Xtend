import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ActionButton, ExportLinks, MonthPicker, NoteAction, XmHeader } from '@/components/admin/xm/widgets'
import { lagosDateString } from '@/lib/utils'
import { bandVariant, fmtScore, monthLabel, monthStart, type XmGrade } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Grades — X Metrics' }

type Kept = { id: string; grade: XmGrade; review_note: string | null; finalised_at: string }

export default async function GradesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role !== 'admin'
  const month = monthStart((await searchParams).month)
  const supabase = await createServerSupabase()
  const ended = month < monthStart(lagosDateString())

  const { data: kept } = await supabase
    .from('xm_monthly_grades')
    .select('id, grade, review_note, finalised_at')
    .eq('month', month)
  const finalised = (kept ?? []).length > 0
  let rows: { id: string | null; g: XmGrade; review: string | null }[]
  let loadError = false
  if (finalised) {
    rows = ((kept ?? []) as Kept[]).map((k) => ({ id: k.id, g: k.grade, review: k.review_note }))
  } else {
    const { data, error } = await supabase.rpc('xm_month_grades', { p_month: month })
    loadError = !!error
    rows = ((data ?? []) as XmGrade[]).map((g) => ({ id: null, g, review: null }))
  }
  rows.sort((a, b) => (b.g.score ?? -1) - (a.g.score ?? -1))
  const w = rows[0]?.g.weights

  return (
    <div className="space-y-5">
      <XmHeader
        title="Monthly grades"
        intro="Each merchandiser and marketer, graded on sales against target, stock accuracy, reporting consistency (against the days they clocked in) and expiry handling. Weights and bands are set in Settings."
        readOnly={readOnly}
      />
      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker month={month} />
        <ExportLinks kind="grades" month={month} />
        {!readOnly && !finalised && ended && (
          <ActionButton
            url="/api/admin/metrics/grades/finalise"
            body={{ month }}
            variant="default"
            confirm={`Keep the grades for ${monthLabel(month)} as they stand? They will not change after this.`}
            done={(d) => `${(d as { data?: number }).data ?? 0} grades kept.`}
          >
            Finalise {monthLabel(month)}
          </ActionButton>
        )}
      </div>
      {finalised ? (
        <Alert variant="success">These grades were finalised and do not change. Add a review note to any of them.</Alert>
      ) : (
        <Alert variant="info">
          Live grades: they change as counts, sales and targets come in.
          {ended ? ' Finalise the month to keep them.' : ' A month can be finalised once it has ended.'}
        </Alert>
      )}
      {loadError && <Alert variant="destructive">The grades could not be worked out. Has migration 043 been run?</Alert>}
      {w && (
        <p className="text-xs text-muted-foreground">
          Weights: sales {w.sales} · accuracy {w.accuracy} · consistency {w.consistency} · expiry {w.expiry}. Bands: Poor below{' '}
          {rows[0].g.bands.poor_below}, Strong from {rows[0].g.bands.strong_from}. A factor with nothing to judge is left out and the
          rest scaled to 100.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Nobody to grade for {monthLabel(month)}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                  <TableHead className="text-right">Consistency</TableHead>
                  <TableHead className="text-right">Expiry</TableHead>
                  {finalised && <TableHead>Review</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ id, g, review }) => (
                  <TableRow key={g.user_id}>
                    <TableCell>
                      <Link className="font-semibold hover:underline" href={`/admin/metrics/staff/${g.user_id}?month=${month.slice(0, 7)}`}>
                        {g.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-bold">{fmtScore(g.score)}</TableCell>
                    <TableCell>
                      <Badge variant={bandVariant(g.band)}>{g.band ?? 'Not graded'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtScore(g.sales.score)}
                      <span className="block text-xs text-muted-foreground">
                        {g.sales.target
                          ? `${g.sales.target_kind === 'store' ? (g.sales.store_units_sold ?? 0) : g.sales.units_sold} / ${g.sales.target}`
                          : 'No target'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtScore(g.accuracy.score)}
                      <span className="block text-xs text-muted-foreground">
                        {g.accuracy.within_tolerance}/{g.accuracy.reconciliations} ok
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtScore(g.consistency.score)}
                      <span className="block text-xs text-muted-foreground">{g.consistency.days_present} days present</span>
                    </TableCell>
                    <TableCell className="text-right">{fmtScore(g.expiry.score)}</TableCell>
                    {finalised && (
                      <TableCell className="max-w-xs text-xs">
                        {review && <p className="mb-1">{review}</p>}
                        {!readOnly && id && (
                          <NoteAction
                            url={`/api/admin/metrics/grades/${id}`}
                            label={review ? 'Change note' : 'Add note'}
                            field="note"
                            placeholder="Review note"
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
