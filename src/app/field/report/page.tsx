import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { ReportForm } from '@/components/field/report-form'
import { Alert } from '@/components/ui/alert'

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
  const session = await requireSession(['merchandiser', 'admin'])
  const supabase = await createServerSupabase()

  const { data: today } = await supabase.rpc('business_date')
  const { data: report } = await supabase
    .from('reports')
    .select('id, report_date, body, sales_summary, stock_status, competitor_activity, issues')
    .eq('user_id', session.userId)
    .eq('report_date', today)
    .maybeSingle<ReportRow>()

  const { count: photoCount } = report
    ? await supabase
        .from('report_photos')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', report.id)
    : { count: 0 }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Daily report</h1>
        <p className="text-sm text-muted-foreground">
          One report per day. You can edit it until midnight, not after.
        </p>
      </div>

      {report && <Alert variant="info">Today’s report is filed. Any change below replaces it.</Alert>}

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
    </div>
  )
}
