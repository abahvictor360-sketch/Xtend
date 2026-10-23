import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, ApiError } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { renderExport } from '@/lib/export/render'
import { XM_EXPORTS, xmSheet, type XmExportKind } from '@/lib/metrics/export'
import { monthStart } from '@/lib/metrics/shared'
import { readXmFeatures } from '@/lib/metrics/features-server'
import { XM_OFF_MESSAGE, xmExportOn } from '@/lib/metrics/features'

export const maxDuration = 60

/** X Metrics grades and stock reports as Excel, Word, PDF or CSV. */
export async function GET(request: Request, ctx: { params: Promise<{ kind: string; format: string }> }) {
  try {
    // Supervisors download what they can already see: RLS narrows it to their team.
    await requireApiSession(['admin', 'supervisor'])
    const { kind, format } = await ctx.params
    if (!XM_EXPORTS.includes(kind as XmExportKind)) throw new ApiError('Unknown report', 404)
    const url = new URL(request.url)
    const month = monthStart(url.searchParams.get('month'))
    const outletParam = url.searchParams.get('outlet')
    const outlet = outletParam && /^[0-9a-f-]{36}$/i.test(outletParam) ? outletParam : null

    const supabase = await createServerSupabase()
    // A report whose part is switched off (0063) is not offered.
    const features = await readXmFeatures(supabase)
    if (!xmExportOn(features, kind)) throw new ApiError(XM_OFF_MESSAGE, 404)
    const sheet = await xmSheet(supabase, kind as XmExportKind, month, outlet, features)
    await audit(supabase, `export.xm_${kind}.${format}`, null, null, { month, outlet, row_count: sheet.rows.length })
    return await renderExport(format, sheet)
  } catch (error) {
    return apiError(error)
  }
}
