import { createServerSupabase } from '@/lib/supabase/server'
import { ApiError, apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { renderExport } from '@/lib/export/render'
import {
  coverageSheet,
  fetchCoverage,
  fetchVisits,
  parseVisitFilter,
  toVisitRows,
  visitSheet,
} from '@/lib/export/visits'
import { SHORT_MINUTES, coverage, notVisitedIn } from '@/lib/visit-review'
import { lagosDateString } from '@/lib/utils'

export const maxDuration = 60

/**
 * Store visits as Excel, Word, PDF or CSV. The file is generated here, from
 * whatever filter is on screen, so an admin never has to assemble one. On
 * the store coverage view, the file is that list of stores instead.
 */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseVisitFilter(new URL(request.url))
    const supabase = await createServerSupabase()

    if (filter.view === 'coverage') {
      const today = lagosDateString()
      const got = await fetchCoverage(supabase)
      if (got.error) throw new ApiError(got.error, 400)
      const all = coverage(got.rows, today, session.profile.role === 'admin')
      const rows = filter.gap ? notVisitedIn(all, filter.gap) : all
      await audit(supabase, `export.coverage.${format}`, 'store_visits', null, { gap: filter.gap, row_count: rows.length })
      return await renderExport(format, coverageSheet(rows, today))
    }

    const short = filter.short ?? SHORT_MINUTES
    const visits = await fetchVisits(supabase, filter)
    const rows = await toVisitRows(supabase, visits, short)

    // Supervisors' actions are audited too (0049), with where and on what.
    await audit(supabase, `export.visits.${format}`, 'store_visits', null, {
      ...filter,
      row_count: visits.length,
    })

    return await renderExport(format, visitSheet(visits, rows, short))
  } catch (error) {
    return apiError(error)
  }
}
