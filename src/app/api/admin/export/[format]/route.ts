import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { renderExport } from '@/lib/export/render'
import { attendanceSheet, fetchAttendance, parseFilter, toExportRows } from '@/lib/export/data'

export const maxDuration = 60

/** Exports are generated server-side, for whatever filter is applied. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseFilter(new URL(request.url))

    const supabase = await createServerSupabase()
    const rows = await fetchAttendance(supabase, filter)
    const exportRows = await toExportRows(supabase, rows)

    await audit(supabase, `export.${format}`, 'attendance', null, {
      ...filter,
      row_count: rows.length,
    })

    return await renderExport(format, attendanceSheet(exportRows))
  } catch (error) {
    return apiError(error)
  }
}
