import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { renderExport } from '@/lib/export/render'
import { fetchVisits, parseVisitFilter, toVisitRows, visitSheet } from '@/lib/export/visits'

export const maxDuration = 60

/**
 * Store visits as Excel, Word, PDF or CSV. The file is generated here, from
 * whatever filter is on screen, so an admin never has to assemble one.
 */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseVisitFilter(new URL(request.url))

    const supabase = await createServerSupabase()
    const visits = await fetchVisits(supabase, filter)
    const rows = await toVisitRows(supabase, visits)

    // Supervisors' actions are audited too (0049), with where and on what.
    await audit(supabase, `export.visits.${format}`, 'store_visits', null, {
      ...filter,
      row_count: visits.length,
    })

    return await renderExport(format, visitSheet(visits, rows))
  } catch (error) {
    return apiError(error)
  }
}
