import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { ApiError, apiError, dbErrorMessage, requireApiSession, REPORTING_ROLES } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { REPORT_FILE_BUCKET, downloadName } from '@/lib/report-files'

const id = z.string().uuid()

interface FileRow {
  id: string
  user_id: string
  staff_name: string
  report_date: string
  path: string
  name: string
  mime: string
  size_bytes: number
}

/**
 * Opens a document attached to a daily report (0064) through a link that
 * lasts five minutes. Read as the caller, so RLS decides who may: the
 * owner, an admin, or the owner's supervisor; anyone else gets "not found".
 * Office downloads are audited.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession()
    const parsed = id.safeParse((await ctx.params).id)
    if (!parsed.success) throw new ApiError('That document was not found', 404)

    const supabase = await createServerSupabase()
    const { data: file } = await supabase
      .from('report_file_detail')
      .select('id, user_id, staff_name, report_date, path, name, mime, size_bytes')
      .eq('id', parsed.data)
      .maybeSingle<FileRow>()
    if (!file) throw new ApiError('That document was not found', 404)

    const { data: signed, error } = await supabase.storage
      .from(REPORT_FILE_BUCKET)
      .createSignedUrl(file.path, 300, { download: downloadName(file.name) })
    if (error || !signed?.signedUrl) throw new ApiError('The document could not be opened. Try again.', 502)

    if (file.user_id !== session.userId) {
      await audit(supabase, 'report_file.download', 'report_files', file.id, {
        staff: file.staff_name,
        report_date: file.report_date,
        name: file.name,
        size_bytes: file.size_bytes,
      })
    }

    return Response.redirect(signed.signedUrl, 302)
  } catch (error) {
    return apiError(error)
  }
}

/**
 * Takes a document off the caller's own report while the report can still
 * be edited (the day it was filed). The database decides; the stored file
 * is then deleted, which storage only allows once it is off the report.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(REPORTING_ROLES)
    const parsed = id.safeParse((await ctx.params).id)
    if (!parsed.success) return Response.json({ error: 'That document was not found' }, { status: 404 })

    const supabase = await createServerSupabase()
    const { data: path, error } = await supabase.rpc('remove_report_file', { p_id: parsed.data })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    // Best effort: the document is already off the report either way.
    if (typeof path === 'string' && path) {
      await supabase.storage.from(REPORT_FILE_BUCKET).remove([path])
    }
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
