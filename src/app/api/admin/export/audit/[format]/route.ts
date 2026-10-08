import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { auditSheet, fetchAudit, parseAuditFilter } from '@/lib/audit-log'
import { renderExport } from '@/lib/export/render'

export const maxDuration = 60

/** The audit log, as filtered on screen, as Excel, Word, PDF or CSV. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { format } = await ctx.params
    const filter = parseAuditFilter(new URL(request.url).searchParams)
    const supabase = await createServerSupabase()
    const { rows, flags } = await fetchAudit(supabase, filter, 2000)
    const response = await renderExport(format, auditSheet(rows, flags, filter))
    // Exporting the audit log is itself an action worth a row.
    await audit(supabase, `export.audit.${format}`, 'audit_log', null, { ...filter, row_count: rows.length })
    return response
  } catch (error) {
    return apiError(error)
  }
}
