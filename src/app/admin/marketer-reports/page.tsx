import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { loadMarketerRows, type MarketerRow } from '@/lib/marketer-report-server'
import { MarketerReportList } from '@/components/admin/marketer-report-list'
import { ReportFileList, type OfficeReportFile } from '@/components/admin/report-file-list'
import { monthName, parseReportRequest, type ReportKind } from '@/lib/marketer-report'
import { chip } from '@/components/admin/visit-views'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addDays, lagosDateString, longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Marketer reports — Xtend' }

type Search = Record<string, string | string[] | undefined>

export default async function MarketerReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
  const params = await searchParams
  const today = lagosDateString()
  const req = parseReportRequest(params, today)
  const supabase = await createServerSupabase()

  let rows: MarketerRow[] = []
  let error: string | null = null
  try {
    rows = await loadMarketerRows(supabase, req.from, req.to)
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not load the people.'
  }
  const only = req.userId ? rows.filter((r) => r.id === req.userId) : []
  const shown = only.length ? only : rows

  // Documents attached to the daily reports in the period (0064), for the
  // people shown. RLS keeps a supervisor to their own team.
  let files: OfficeReportFile[] = []
  {
    let q = supabase
      .from('report_file_detail')
      .select('id, user_id, staff_name, report_date, name, mime, size_bytes')
      .gte('report_date', req.from)
      .lte('report_date', req.to)
    if (only.length && req.userId) q = q.eq('user_id', req.userId)
    const { data } = await q.order('report_date', { ascending: false }).order('created_at').limit(500)
    files = (data ?? []) as OfficeReportFile[]
  }

  const period = req.kind === 'day' ? (req.date === today ? `Today, ${longDate(req.date)}` : longDate(req.date)) : monthName(req.month)
  const key = req.kind === 'day' ? req.date : req.month
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const href = (kind: ReportKind, value: string) => {
    const q = new URLSearchParams({ period: kind })
    q.set(kind === 'day' ? 'date' : 'month', value)
    if (only.length && req.userId) q.set('user_id', req.userId)
    return `?${q.toString()}`
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Marketer reports</h1>
        <p className="text-sm text-muted-foreground">
          A report to download for each marketer, for one day or a whole month: when they clocked in and out, every store
          they checked in to and how long they spent there, the time between stores, and the daily report they filed.
          PDF is the one to share; Word and Excel hold the same.
          {!isAdmin && ' You see your own team only.'} Times are Africa/Lagos.
        </p>
      </div>

      <form method="get" className="space-y-3">
        {only.length > 0 && req.userId && <input type="hidden" name="user_id" value={req.userId} />}
        <div className="flex flex-wrap gap-2">
          <Link href={href('day', req.date)} className={chip(req.kind === 'day')}>
            A day
          </Link>
          <Link href={href('month', req.month)} className={chip(req.kind === 'month')}>
            A month
          </Link>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="period" value={req.kind} />
          {req.kind === 'day' ? (
            <div className="space-y-1.5">
              <Label htmlFor="date">Day</Label>
              <Input id="date" name="date" type="date" defaultValue={req.date} max={today} className="h-10 w-44" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="month">Month</Label>
              <Input id="month" name="month" type="month" defaultValue={req.month} max={today.slice(0, 7)} className="h-10 w-44" />
            </div>
          )}
          <Button type="submit" className="h-10">
            Show
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Quick:</span>
          {req.kind === 'day' ? (
            <>
              <Link href={href('day', today)} className={chip(req.date === today)}>
                Today
              </Link>
              <Link href={href('day', addDays(today, -1))} className={chip(req.date === addDays(today, -1))}>
                Yesterday
              </Link>
            </>
          ) : (
            <>
              <Link href={href('month', today.slice(0, 7))} className={chip(req.month === today.slice(0, 7))}>
                This month
              </Link>
              <Link href={href('month', lastMonth)} className={chip(req.month === lastMonth)}>
                Last month
              </Link>
            </>
          )}
        </div>
      </form>

      {error && <Alert variant="destructive">Could not load the people: {error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>{period}</CardTitle>
          <CardDescription>
            {only.length
              ? 'One person. '
              : `${shown.length} ${shown.length === 1 ? 'person' : 'people'}: every marketer, and anyone else who checked in to a store in this period. `}
            Tap PDF, Word or Excel to download their {req.kind === 'day' ? 'day' : 'month'} report.
            {only.length > 0 && (
              <>
                {' '}
                <Link href={`?${new URLSearchParams({ period: req.kind, [req.kind === 'day' ? 'date' : 'month']: key })}`} className="font-semibold text-brand hover:underline">
                  Show everyone
                </Link>
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarketerReportList rows={shown} kind={req.kind} periodKey={key} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents attached ({files.length})</CardTitle>
          <CardDescription>
            Files staff attached to their daily reports in this period: price lists, plans, invoices, pictures.
            The PDF, Word and Excel reports list them by name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReportFileList files={files} />
        </CardContent>
      </Card>
    </div>
  )
}
