import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronRight, Store } from 'lucide-react'
import { REPORTING_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { ReportForm } from '@/components/field/report-form'
import { ReportVisits } from '@/components/field/report-visits'
import type { SavedReportFile } from '@/components/field/report-files'
import type { SourceVisit } from '@/lib/marketer-report'
import { SheetScreen, HeaderField } from '@/components/field/screen'
import { Badge } from '@/components/ui/badge'
import { addDays, formatLagos, longDate } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Daily report — Xtend' }

interface ReportRow {
  id: string
  report_date: string
  scope?: 'day' | 'store'
  store_visit_id?: string | null
  body: string | null
  sales_summary: string | null
  stock_status: string | null
  competitor_activity: string | null
  issues: string | null
}

type TodayVisit = SourceVisit & { id: string }

const FIELDS = 'id, report_date, body, sales_summary, stock_status, competitor_activity, issues'

function visitName(v: TodayVisit) {
  return v.store_label ?? v.outlet_name ?? 'A store'
}

/** How far back a report can be written (0094, report_days_back()). */
const DAYS_BACK = 7

/**
 * The daily report. A marketer first says which day it is for (0094):
 * today, yesterday or another of the last 7 days, so the evening's or the
 * next morning's reports land on the right day; then what it is for
 * (0088): the whole day, or one store they checked in at that day.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string; day?: string }>
}) {
  const session = await requireSession()
  if (!REPORTING_ROLES.includes(session.profile.role)) redirect('/field')
  const supabase = await createServerSupabase()
  const params = await searchParams
  const choice = params.for ?? null

  const { data: today } = await supabase.rpc('business_date')
  const todayDate = (today as string) ?? ''
  const earliest = todayDate ? addDays(todayDate, -DAYS_BACK) : ''
  const asked = typeof params.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : null
  const dayLabel = (d: string) => (d === todayDate ? `Today, ${longDate(d)}` : d === addDays(todayDate, -1) ? `Yesterday, ${longDate(d)}` : longDate(d))

  // ---- First: which day is this report for? ----------------------------------
  if (!asked || asked > todayDate || asked < earliest) {
    const [{ data: recentVisits }, { data: recentReports }] = await Promise.all([
      supabase
        .from('store_visits')
        .select('visit_date')
        .eq('user_id', session.userId)
        .gte('visit_date', earliest)
        .lte('visit_date', todayDate)
        .limit(500),
      supabase.from('reports').select('report_date').eq('user_id', session.userId).gte('report_date', earliest).limit(500),
    ])
    const visitsOn = (d: string) => ((recentVisits ?? []) as { visit_date: string }[]).filter((v) => v.visit_date === d).length
    const reportsOn = (d: string) => ((recentReports ?? []) as { report_date: string }[]).filter((r) => r.report_date === d).length
    const days = Array.from({ length: DAYS_BACK + 1 }, (_, i) => addDays(todayDate, -i)).filter(
      (d, i) => i < 2 || visitsOn(d) > 0,
    )
    return (
      <SheetScreen title="Daily report" back="/field" header={<HeaderField label="Filed by" value={session.profile.full_name} />}>
        <div className="space-y-5">
          {asked && (
            <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">
              Reports can be written for today and up to {DAYS_BACK} days back. Pick another day.
            </p>
          )}
          <div>
            <h2 className="text-base font-bold">Which day is this report for?</h2>
            <p className="text-sm text-muted-foreground">
              Write it the same evening, or the next morning before you clock in. Pick the day you visited the stores.
            </p>
          </div>
          <div className="space-y-2">
            {days.map((d) => {
              const v = visitsOn(d)
              const r = reportsOn(d)
              return (
                <ChoiceLink
                  key={d}
                  href={`/field/report?day=${d}`}
                  icon={<CalendarDays className="h-5 w-5" />}
                  title={dayLabel(d)}
                  detail={`${v ? `${v} store${v === 1 ? '' : 's'} visited` : 'No store visits'}${r ? ` · ${r} report${r === 1 ? '' : 's'} written` : ''}`}
                  filed={false}
                  badge={r ? 'Open' : 'Write'}
                />
              )
            })}
          </div>
          <form method="get" action="/field/report" className="space-y-2 rounded-2xl border border-border bg-card p-3">
            <label htmlFor="report-day" className="text-sm font-semibold">
              Another day
            </label>
            <div className="flex gap-2">
              <Input id="report-day" name="day" type="date" min={earliest} max={todayDate} defaultValue={addDays(todayDate, -1)} className="h-11 flex-1" required />
              <Button type="submit" className="h-11">
                Open
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Up to {DAYS_BACK} days back.</p>
          </form>
        </div>
      </SheetScreen>
    )
  }

  const businessDate = asked
  const dayQuery = `day=${businessDate}`

  const [{ data: withScope, error: scopeError }, { data: outlet }, { data: visitRows }] = await Promise.all([
    supabase
      .from('reports')
      .select(`${FIELDS}, scope, store_visit_id`)
      .eq('user_id', session.userId)
      .eq('report_date', businessDate),
    supabase
      .from('outlets')
      .select('name')
      .eq('id', session.profile.outlet_id ?? '')
      .maybeSingle<{ name: string }>(),
    // That day's store visits (0094); today's from the older call before it runs.
    supabase.rpc('my_visits_on', { p_day: businessDate }).then((res) =>
      res.error && businessDate === todayDate ? supabase.rpc('my_store_visits') : res,
    ),
  ])

  // Before 0088 runs there is no scope: one whole-day report, no choice.
  const legacy = Boolean(scopeError)
  let reports = (withScope ?? []) as ReportRow[]
  if (legacy) {
    const { data } = await supabase
      .from('reports')
      .select(FIELDS)
      .eq('user_id', session.userId)
      .eq('report_date', businessDate)
    reports = ((data ?? []) as ReportRow[]).map((r) => ({ ...r, scope: 'day' as const, store_visit_id: null }))
  }

  const visits = ((visitRows ?? []) as TodayVisit[]).slice().sort((a, b) => a.arrived_at.localeCompare(b.arrived_at))
  const dayReport = reports.find((r) => (r.scope ?? 'day') === 'day') ?? null
  const storeReport = (visitId: string) =>
    reports.find((r) => r.scope === 'store' && r.store_visit_id === visitId) ?? null

  // ---- The choice: what is this report for? -------------------------------
  const target = legacy ? 'day' : choice
  const pickedVisit = target && target !== 'day' ? (visits.find((v) => v.id === target) ?? null) : null
  if (!target || (target !== 'day' && !pickedVisit)) {
    return (
      <SheetScreen
        title="Daily report"
        back="/field"
        header={
          <>
            <HeaderField label="Filed by" value={session.profile.full_name} />
            <HeaderField label="Day" value={dayLabel(businessDate)} />
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-tint px-4 py-3 text-sm">
            <span>
              Report for <span className="font-semibold">{dayLabel(businessDate)}</span>
            </span>
            <Link href="/field/report" className="font-semibold text-brand hover:underline">
              Change day
            </Link>
          </div>
          <div>
            <h2 className="text-base font-bold">What is this report for?</h2>
            <p className="text-sm text-muted-foreground">
              Write one for each store you checked in at that day, and one for the whole day if you like.
            </p>
          </div>

          <ChoiceLink
            href={`/field/report?${dayQuery}&for=day`}
            icon={<CalendarDays className="h-5 w-5" />}
            title="The whole day"
            detail="All your work that day, across every store."
            filed={Boolean(dayReport)}
          />

          <div className="space-y-2">
            <p className="text-sm font-semibold">One store</p>
            {visits.length ? (
              visits.map((v) => (
                <ChoiceLink
                  key={v.id}
                  href={`/field/report?${dayQuery}&for=${encodeURIComponent(v.id)}`}
                  icon={<Store className="h-5 w-5" />}
                  title={visitName(v)}
                  detail={`Checked in ${formatLagos(v.arrived_at, false)}${v.status === 'open' ? ' · still here' : ''}`}
                  filed={Boolean(storeReport(v.id))}
                />
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                {businessDate === todayDate
                  ? 'Check in at a store first, then you can write a report for it.'
                  : 'No store visits that day. You can still write one for the whole day.'}
              </p>
            )}
          </div>
        </div>
      </SheetScreen>
    )
  }

  // ---- The report itself -----------------------------------------------------
  const report = pickedVisit ? storeReport(pickedVisit.id) : dayReport
  const [{ count: photoCount }, { data: fileRows }] = report
    ? await Promise.all([
        supabase
          .from('report_photos')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', report.id),
        // Documents attached to it (0064). Empty before the migration runs.
        supabase
          .from('report_files')
          .select('id, name, mime, size_bytes')
          .eq('report_id', report.id)
          .order('created_at'),
      ])
    : [{ count: 0 }, { data: [] }]

  const forLabel = pickedVisit ? visitName(pickedVisit) : 'The whole day'

  return (
    <SheetScreen
      title={report ? 'Edit report' : 'New report'}
      back={legacy ? '/field' : `/field/report?${dayQuery}`}
      header={
        <>
          <HeaderField label="Filed by" value={session.profile.full_name} />
          <HeaderField
            label="Report for"
            value={pickedVisit ? forLabel : legacy ? (outlet?.name ?? 'No outlet assigned') : forLabel}
          />
          <HeaderField label="Day" value={dayLabel(businessDate)} />
        </>
      }
    >
      {!legacy && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-tint px-4 py-3 text-sm">
          <span>
            Report for <span className="font-semibold">{forLabel}</span>, {dayLabel(businessDate)}
          </span>
          <Link href={`/field/report?${dayQuery}`} className="font-semibold text-brand hover:underline">
            Change
          </Link>
        </div>
      )}
      <div className="mb-5">
        <ReportVisits visits={pickedVisit ? [pickedVisit] : visits} today={businessDate} />
      </div>
      <ReportForm
        key={`${businessDate}-${pickedVisit?.id ?? 'day'}`}
        scope={pickedVisit ? 'store' : 'day'}
        storeVisitId={pickedVisit?.id ?? null}
        reportDate={businessDate}
        isToday={businessDate === todayDate}
        existing={
          report
            ? {
                body: report.body ?? '',
                sales_summary: report.sales_summary ?? '',
                stock_status: report.stock_status ?? '',
                competitor_activity: report.competitor_activity ?? '',
                issues: report.issues ?? '',
              }
            : null
        }
        photosAlready={photoCount ?? 0}
        files={(fileRows ?? []) as SavedReportFile[]}
      />
    </SheetScreen>
  )
}

function ChoiceLink({
  href,
  icon,
  title,
  detail,
  filed,
  badge,
}: {
  href: string
  icon: React.ReactNode
  title: string
  detail: string
  filed: boolean
  /** Words for the badge instead of "Filed · edit" / "Not yet". */
  badge?: string
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-tint"
    >
      <span className="icon-tile">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <Badge variant={filed ? 'success' : 'outline'}>{badge ?? (filed ? 'Filed · edit' : 'Not yet')}</Badge>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
