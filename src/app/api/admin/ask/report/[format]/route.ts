import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { renderExport } from '@/lib/export/render'
import { buildReportSheet } from '@/lib/assistant-report'
import { parseReportSpec } from '@/lib/assistant-report-spec'

export const maxDuration = 60

/**
 * Downloads a report the assistant created. The rows are rebuilt here, for
 * the person clicking, so the file only ever holds what RLS lets them see.
 */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const parsed = parseReportSpec(new URL(request.url))
    if (!parsed.success) {
      return Response.json({ error: 'That report link is not valid.' }, { status: 400 })
    }
    const spec = parsed.data
    if (spec.kind === 'staff_history' && !spec.name) {
      return Response.json({ error: 'That report link is not valid.' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const sheet = await buildReportSheet(supabase, spec)

    await audit(supabase, `export.${format}`, 'assistant_report', null, {
      kind: spec.kind,
      from: spec.from,
      to: spec.to,
      name: spec.name,
      row_count: sheet.rows.length,
    })

    return await renderExport(format, sheet)
  } catch (error) {
    return apiError(error)
  }
}
