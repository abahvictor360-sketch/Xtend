import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { group, summarise } from '@/lib/attendance-report'
import { loadAnalytics, parseReportFilter } from '@/lib/attendance-server'
import { analyticsSheet } from '@/lib/export/attendance-days'
import { renderExport } from '@/lib/export/render'

export const maxDuration = 60

/** The Analytics page's comparison table (by person, store or team), as Excel, Word, PDF or CSV. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseReportFilter(new URL(request.url).searchParams, 30)
    const supabase = await createServerSupabase()
    const { now, before, previous } = await loadAnalytics(supabase, filter)
    const rows = group(now.records, now.people, filter.by)
    const earlier = new Map(group(before.records, before.people, filter.by).map((r) => [r.key, r]))
    const sheet = analyticsSheet(rows, earlier, summarise(now.records), summarise(before.records), filter, now.people, previous)
    const response = await renderExport(format, sheet)
    await audit(supabase, `export.analytics.${format}`, 'attendance', null, {
      from: filter.from,
      to: filter.to,
      by: filter.by,
      outlet_id: filter.outlet_id,
      team: filter.team,
      role: filter.role,
      row_count: rows.length,
    })
    return response
  } catch (error) {
    return apiError(error)
  }
}
