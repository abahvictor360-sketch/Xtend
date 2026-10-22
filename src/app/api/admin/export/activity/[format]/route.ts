import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { activitySheet, parseActivityFilter } from '@/lib/activity-log'
import { fetchActivity } from '@/lib/activity-server'
import { renderExport } from '@/lib/export/render'

export const maxDuration = 60

/** The activity log, as filtered on screen, as Excel, Word, PDF or CSV. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { format } = await ctx.params
    const filter = parseActivityFilter(new URL(request.url).searchParams)
    const supabase = await createServerSupabase()
    const [{ rows }, { data: people }] = await Promise.all([
      fetchActivity(supabase, filter, 5000),
      filter.person
        ? supabase.from('profiles').select('id, full_name').eq('id', filter.person)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ])
    const response = await renderExport(format, activitySheet(rows, filter, people ?? []))
    await audit(supabase, `export.activity.${format}`, 'user_activity', null, { ...filter, row_count: rows.length })
    return response
  } catch (error) {
    return apiError(error)
  }
}
