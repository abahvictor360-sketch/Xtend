import { createServerSupabase } from '@/lib/supabase/server'
import { ApiError, apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { parseReportRequest } from '@/lib/marketer-report'
import { loadMarketerReport } from '@/lib/marketer-report-server'
import { isMarketerReportFormat, renderMarketerReport } from '@/lib/export/marketer-report'
import { lagosDateString } from '@/lib/utils'

export const maxDuration = 60

/**
 * One marketer's report for a day or a month, as PDF, Word or Excel.
 * Read through the caller's own client, so a supervisor only gets their
 * own team; anyone else is "not found".
 */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    if (!isMarketerReportFormat(format)) throw new ApiError('Unsupported export format', 400)
    const req = parseReportRequest(new URL(request.url).searchParams, lagosDateString())
    if (!req.userId) throw new ApiError('Choose a person first', 400)

    const supabase = await createServerSupabase()
    const report = await loadMarketerReport(supabase, { ...req, userId: req.userId })
    if (!report) throw new ApiError('That person was not found', 404)

    await audit(supabase, `export.marketer_report.${format}`, 'profiles', req.userId, {
      period: req.kind,
      from: req.from,
      to: req.to,
      visits: report.totals.visits,
      days_worked: report.totals.daysWorked,
    })

    return await renderMarketerReport(format, report)
  } catch (error) {
    return apiError(error)
  }
}
