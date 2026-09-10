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
    const session = await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseVisitFilter(new URL(request.url))

    const supabase = await createServerSupabase()
    const visits = await fetchVisits(supabase, filter)
    const rows = await toVisitRows(supabase, visits)

    // A supervisor may export but may not write an audit row, so theirs is
    // recorded by the admin client instead of being silently skipped.
    if (session.profile.role === 'admin') {
      await audit(supabase, `export.visits.${format}`, 'store_visits', null, {
        ...filter,
        row_count: visits.length,
      })
    } else {
      const { createAdminSupabase } = await import('@/lib/supabase/admin')
      const admin = createAdminSupabase()
      await admin
        .from('audit_log')
        .insert({
          actor_id: session.userId,
          action: `export.visits.${format}`,
          target_table: 'store_visits',
          meta: { ...filter, row_count: visits.length },
        })
    }

    return await renderExport(format, visitSheet(visits, rows))
  } catch (error) {
    return apiError(error)
  }
}
