import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { applyIntegrityFilter, fetchIntegrity, integritySheet, parseIntegrityFilter } from '@/lib/integrity-review'
import { renderExport } from '@/lib/export/render'

export const maxDuration = 60

/**
 * The integrity flags, as filtered on screen, as Excel, Word, PDF or CSV.
 * Read through the caller's session, so a supervisor gets their team only.
 */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const filter = parseIntegrityFilter(new URL(request.url).searchParams)
    const supabase = await createServerSupabase()
    const { rows } = await fetchIntegrity(supabase, filter, 5000)
    const shown = applyIntegrityFilter(rows, filter)
    const response = await renderExport(format, integritySheet(shown, filter))
    await audit(supabase, `export.integrity.${format}`, 'integrity_flags', null, { ...filter, row_count: shown.length })
    return response
  } catch (error) {
    return apiError(error)
  }
}
