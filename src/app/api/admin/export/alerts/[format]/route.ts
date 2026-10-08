import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { parseAlertFilter } from '@/lib/alert-review'
import { alertSheet, fetchAlerts } from '@/lib/export/alerts'
import { renderExport } from '@/lib/export/render'

export const maxDuration = 60

/** Alerts, as filtered on screen, as Excel, Word, PDF or CSV. RLS keeps a supervisor to their team. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseAlertFilter(new URL(request.url).searchParams)
    const supabase = await createServerSupabase()
    const { alerts } = await fetchAlerts(supabase, filter, 3000)
    await audit(supabase, `export.alerts.${format}`, 'location_alerts', null, { ...filter, row_count: alerts.length })
    return await renderExport(format, alertSheet(alerts, filter))
  } catch (error) {
    return apiError(error)
  }
}
