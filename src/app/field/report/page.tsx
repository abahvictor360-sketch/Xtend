import { redirect } from 'next/navigation'
import { REPORTING_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { ReportForm } from '@/components/field/report-form'
import { ReportVisits } from '@/components/field/report-visits'
import type { SourceVisit } from '@/lib/marketer-report'
import { SheetScreen, HeaderField } from '@/components/field/screen'
import { longDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Daily report — Xtend' }

interface ReportRow {
  id: string
  report_date: string
  body: string | null
  sales_summary: string | null
  stock_status: string | null
  competitor_activity: string | null
  issues: string | null
}

export default async function ReportPage() {
  const session = await requireSession()
  if (!REPORTING_ROLES.includes(session.profile.role)) redirect('/field')
  const supabase = await createServerSupabase()

  const { data: today } = await supabase.rpc('business_date')
  const businessDate = (today as string) ?? ''

  // Today's store visits, shown above the form; the database adds them to
  // the report itself when it is saved (060).
  const [{ data: report }, { data: outlet }, { data: visits }] = await Promise.all([
    supabase
      .from('reports')
      .select('id, report_date, body, sales_summary, stock_status, competitor_activity, issues')
      .eq('user_id', session.userId)
      .eq('report_date', businessDate)
      .maybeSingle<ReportRow>(),
    supabase
      .from('outlets')
      .select('name')
      .eq('id', session.profile.outlet_id ?? '')
      .maybeSingle<{ name: string }>(),
    supabase.rpc('my_store_visits'),
  ])

  const { count: photoCount } = report
    ? await supabase
        .from('report_photos')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', report.id)
    : { count: 0 }

  return (
    <SheetScreen
      title={report ? 'Edit today’s report' : 'New daily report'}
      back="/field"
      header={
        <>
          <HeaderField label="Filed by" value={session.profile.full_name} />
          <HeaderField label="Outlet" value={outlet?.name ?? 'No outlet assigned'} />
          <HeaderField
            label="Date"
            value={businessDate ? longDate(businessDate) : 'Today'}
          />
        </>
      }
    >
      <div className="mb-5">
        <ReportVisits visits={(visits ?? []) as SourceVisit[]} today={businessDate} />
      </div>
      <ReportForm
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
      />
    </SheetScreen>
  )
}
