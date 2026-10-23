import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, REPORTING_ROLES, dbErrorMessage, dbErrorResponse } from '@/lib/auth'
import { fileName, writtenText } from '@/lib/fields'
import { MAX_REPORT_FILES } from '@/lib/report-files'

const schema = z.object({
  // What the day, sales and stock were like must be said; competitors and
  // issues may be left empty. All of it in words, without links.
  body: writtenText(4000, 10, '"The day"'),
  sales_summary: writtenText(2000, 10, '"Sales"'),
  stock_status: writtenText(2000, 10, '"Stock"'),
  competitor_activity: writtenText(2000, 0, '"Competitors"'),
  issues: writtenText(2000, 0, '"Issues"'),
  photo_paths: z.array(z.string().min(1)).max(5).default([]),
  // Documents already uploaded to report-files (0064); the database checks
  // each one: theirs, just uploaded, an allowed type, small enough, room left.
  files: z
    .array(z.object({ path: z.string().min(1).max(300), name: fileName }))
    .max(MAX_REPORT_FILES)
    .default([]),
})

/**
 * One report per person per day. A second submission updates the existing
 * row; the database refuses the update on any day but the day it was filed.
 */
export async function POST(request: Request) {
  try {
    // Marketers file the report. The database enforces this as well, in the
    // insert policy and in the trigger.
    const session = await requireApiSession(REPORTING_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid report' },
        { status: 400 },
      )
    }
    const input = parsed.data

    for (const path of [...input.photo_paths, ...input.files.map((f) => f.path)]) {
      if (!path.startsWith(`${session.userId}/`)) {
        return Response.json({ error: 'Photo path does not belong to you' }, { status: 400 })
      }
    }

    const supabase = await createServerSupabase()
    const fields = {
      body: input.body,
      sales_summary: input.sales_summary,
      stock_status: input.stock_status,
      competitor_activity: input.competitor_activity,
      issues: input.issues,
    }

    const { data: existing } = await supabase
      .from('reports')
      .select('id, report_date')
      .eq('user_id', session.userId)
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; report_date: string }>()

    const { data: today } = await supabase.rpc('business_date')
    let reportId = existing && existing.report_date === today ? existing.id : null

    if (reportId) {
      const { error } = await supabase.from('reports').update(fields).eq('id', reportId)
      if (error) return dbErrorResponse(error)
    } else {
      const { data, error } = await supabase
        .from('reports')
        .insert(fields)
        .select('id')
        .single<{ id: string }>()
      if (error) {
        if (error.code === '23505') {
          return Response.json({ error: 'Today’s report is already filed.' }, { status: 409 })
        }
        return dbErrorResponse(error)
      }
      reportId = data.id
    }

    // Each photo is put on the report by the database (0067): one already
    // on today's report (a retry whose first answer was lost) is answered
    // with its row, never added twice; five at most; theirs, just uploaded.
    for (const [index, path] of [...new Set(input.photo_paths)].entries()) {
      const { error } = await supabase.rpc('add_report_photo', { p_path: path })
      if (error) {
        return Response.json(
          { error: `Your report is saved, but photo ${index + 1} was not added: ${dbErrorMessage(error)}` },
          { status: 400 },
        )
      }
    }

    for (const file of input.files) {
      const { error } = await supabase.rpc('add_report_file', { p_path: file.path, p_name: file.name })
      if (error) {
        return Response.json(
          { error: `Your report is saved, but ${file.name || 'a document'} was not attached: ${dbErrorMessage(error)}` },
          { status: 400 },
        )
      }
    }

    return Response.json({ report_id: reportId }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
