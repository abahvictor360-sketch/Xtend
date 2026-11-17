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
import { formatLagos, longDate } from '@/lib/utils'

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

/**
 * The daily report. A marketer first says what it is for (0088): the whole
 * day, or one store they checked in at today. Each has its own report.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>
}) {
  const session = await requireSession()
  if (!REPORTING_ROLES.includes(session.profile.role)) redirect('/field')
  const supabase = await createServerSupabase()
  const choice = (await searchParams).for ?? null

  const { data: today } = await supabase.rpc('business_date')
  const businessDate = (today as string) ?? ''

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
    supabase.rpc('my_store_visits'),
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
            <HeaderField label="Date" value={businessDate ? longDate(businessDate) : 'Today'} />
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-bold">What is this report for?</h2>
            <p className="text-sm text-muted-foreground">
              Write one for a store you checked in at, or one for your whole day. You can do both.
            </p>
          </div>

          <ChoiceLink
            href="/field/report?for=day"
            icon={<CalendarDays className="h-5 w-5" />}
            title="The whole day"
            detail="All your work today, across every store."
            filed={Boolean(dayReport)}
          />

          <div className="space-y-2">
            <p className="text-sm font-semibold">One store</p>
            {visits.length ? (
              visits.map((v) => (
                <ChoiceLink
                  key={v.id}
                  href={`/field/report?for=${encodeURIComponent(v.id)}`}
                  icon={<Store className="h-5 w-5" />}
                  title={visitName(v)}
                  detail={`Checked in ${formatLagos(v.arrived_at, false)}${v.status === 'open' ? ' · still here' : ''}`}
                  filed={Boolean(storeReport(v.id))}
                />
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Check in at a store first, then you can write a report for it.
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
      back={legacy ? '/field' : '/field/report'}
      header={
        <>
          <HeaderField label="Filed by" value={session.profile.full_name} />
          <HeaderField
            label="Report for"
            value={pickedVisit ? forLabel : legacy ? (outlet?.name ?? 'No outlet assigned') : forLabel}
          />
          <HeaderField label="Date" value={businessDate ? longDate(businessDate) : 'Today'} />
        </>
      }
    >
      {!legacy && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-tint px-4 py-3 text-sm">
          <span>
            Report for <span className="font-semibold">{forLabel}</span>
          </span>
          <Link href="/field/report" className="font-semibold text-brand hover:underline">
            Change
          </Link>
        </div>
      )}
      <div className="mb-5">
        <ReportVisits visits={pickedVisit ? [pickedVisit] : visits} today={businessDate} />
      </div>
      <ReportForm
        key={pickedVisit?.id ?? 'day'}
        scope={pickedVisit ? 'store' : 'day'}
        storeVisitId={pickedVisit?.id ?? null}
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
}: {
  href: string
  icon: React.ReactNode
  title: string
  detail: string
  filed: boolean
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
      <Badge variant={filed ? 'success' : 'outline'}>{filed ? 'Filed · edit' : 'Not yet'}</Badge>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
