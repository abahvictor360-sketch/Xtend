import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { loadMarketerRows, type MarketerRow } from '@/lib/marketer-report-server'
import { MarketerReportList } from '@/components/admin/marketer-report-list'
import { ReportFileList, type OfficeReportFile } from '@/components/admin/report-file-list'
import { monthName, parseReportRequest, type ReportKind } from '@/lib/marketer-report'
import { chip } from '@/components/admin/visit-views'
import { duration } from '@/lib/movement'
import { CalendarDays, Clock3, Download, FileText, MapPin, Paperclip, Store, Users } from 'lucide-react'
import { Chip, Panel, PageHeader, SectionTitle, StatCard, StatGrid, TabLinks } from '@/components/admin/page-kit'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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

  const visits = shown.reduce((n, r) => n + r.visits, 0)
  const stores = shown.reduce((n, r) => n + r.stores, 0)
  const minutes = shown.reduce((n, r) => n + r.minutes, 0)
  const reports = shown.reduce((n, r) => n + r.reports, 0)
  const active = shown.filter((r) => r.visits > 0).length
  const silent = shown.filter((r) => r.visits > 0 && r.reports === 0).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketer reports"
        note={`A report to download for each marketer, for one day or a whole month. PDF is the one to share; Word and Excel hold the same.${isAdmin ? '' : ' Your own team only.'} Lagos time.`}
        chips={
          <>
            <Chip icon={CalendarDays}>{period}</Chip>
            <Chip icon={Users}>
              {shown.length} {shown.length === 1 ? 'person' : 'people'}
            </Chip>
          </>
        }
      />

      <StatGrid>
        <StatCard icon={MapPin} label="Store visits" value={String(visits)} note={`${active} of ${shown.length} visited a store`} bar={shown.length ? (active / shown.length) * 100 : null} />
        <StatCard icon={Store} label="Stores reached" value={String(stores)} tone="good" note="Added up per person" />
        <StatCard icon={Clock3} label="Time in stores" value={minutes ? duration(minutes) : '—'} note={visits ? `${duration(Math.round(minutes / visits))} a visit on average` : 'No visits yet'} />
        <StatCard
          icon={FileText}
          label="Daily reports filed"
          value={String(reports)}
          tone={silent ? 'warn' : 'brand'}
          note={silent ? `${silent} visited stores and filed none` : `${files.length} document${files.length === 1 ? '' : 's'} attached`}
        />
      </StatGrid>

      <section className="surface p-4 sm:p-5">
      <form method="get" className="space-y-3">
        {only.length > 0 && req.userId && <input type="hidden" name="user_id" value={req.userId} />}
        <TabLinks
          tabs={[
            { href: href('day', req.date), label: 'A day', active: req.kind === 'day' },
            { href: href('month', req.month), label: 'A month', active: req.kind === 'month' },
          ]}
        />
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
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold hover:text-foreground">What is in a report</summary>
          <p className="mt-1.5 leading-relaxed">
            When they clocked in and out, every store they checked in to and how long they spent there, the time between
            stores, and the daily report they filed, with the names of any documents they attached.
          </p>
        </details>
      </section>

      {error && <Alert variant="destructive">Could not load the people: {error}</Alert>}

      <section className="surface space-y-4 p-4 sm:p-5">
        <SectionTitle
          icon={Download}
          title={`Reports: ${period}`}
          note={<>
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
          </>}
        />
        <MarketerReportList rows={shown} kind={req.kind} periodKey={key} />
      </section>

      <Panel
        icon={Paperclip}
        title={`Documents attached (${files.length})`}
        note="Files staff attached to their daily reports in this period: price lists, plans, invoices, pictures."
      >
        <ReportFileList files={files} />
      </Panel>
    </div>
  )
}
