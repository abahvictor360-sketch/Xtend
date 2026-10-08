import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { loadAttendance, parseReportFilter } from '@/lib/attendance-server'
import { attendanceDaysSheet } from '@/lib/export/attendance-days'
import { renderExport } from '@/lib/export/render'

export const maxDuration = 60

/** The Attendance page's day-by-day table, as filtered on screen, as Excel, Word, PDF or CSV. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseReportFilter(new URL(request.url).searchParams, 1)
    // Through RLS: a supervisor's file holds their own team only.
    const supabase = await createServerSupabase()
    const { report, shown } = await loadAttendance(supabase, filter)
    const response = await renderExport(format, attendanceDaysSheet(shown, report.records, report.people, filter))
    await audit(supabase, `export.attendance_days.${format}`, 'attendance', null, {
      from: filter.from,
      to: filter.to,
      user_id: filter.user_id,
      outlet_id: filter.outlet_id,
      team: filter.team,
      role: filter.role,
      status: filter.status,
      row_count: shown.length,
    })
    return response
  } catch (error) {
    return apiError(error)
  }
}
