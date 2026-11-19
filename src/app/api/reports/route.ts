import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, REPORTING_ROLES, dbErrorMessage, dbErrorResponse } from '@/lib/auth'
import { fileName, writtenText } from '@/lib/fields'
import { MAX_REPORT_FILES } from '@/lib/report-files'
import { isOwnStoragePath } from '@/lib/storage-path'

const schema = z.object({
  // A report for the whole day, or for one store visit of today (0088).
  scope: z.enum(['day', 'store']).default('day'),
  store_visit_id: z.string().guid().nullable().optional(),
  // The day it is for (0094): today, yesterday or up to 7 days back. Left
  // out (an older phone): today. The database checks the day.
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day this report is for.')
    .nullable()
    .optional(),
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
 * One whole-day report per person per day, and one report per store visit
 * (0088), for today or a recent day they pick (0094). Sending the same one
 * again updates it; the database refuses a day ahead, a day more than 7
 * days back, and a past day they did not work.
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
      if (!isOwnStoragePath(path, session.userId)) {
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

    if (input.scope === 'store' && !input.store_visit_id) {
      return Response.json({ error: 'Pick the store this report is for.' }, { status: 400 })
    }

    const { data: businessDay } = await supabase.rpc('business_date')
    const today = (input.report_date ?? (businessDay as string)) as string
    // Before 0094 the database would quietly date a report for another day
    // today: say what is missing instead.
    if (input.report_date && input.report_date !== businessDay) {
      const { error: missing } = await supabase.rpc('report_days_back')
      if (missing) {
        return Response.json(
          { error: 'Writing a report for another day needs update 0094. Ask an admin to run it; for now, write it for today.' },
          { status: 503 },
        )
      }
    }
    let lookup = supabase
      .from('reports')
      .select('id')
      .eq('user_id', session.userId)
      .eq('report_date', today as string)
      .eq('scope', input.scope)
    if (input.scope === 'store') lookup = lookup.eq('store_visit_id', input.store_visit_id!)
    const { data: existing, error: lookupError } = await lookup.limit(1).maybeSingle<{ id: string }>()
    // Before 0088 runs there is no scope column: one report per day, as
    // before, whatever was picked.
    const legacy = Boolean(lookupError && /scope|store_visit_id|42703|PGRST204/.test(`${lookupError.code} ${lookupError.message}`))
    let reportId = existing?.id ?? null
    if (legacy) {
      const { data: old } = await supabase
        .from('reports')
        .select('id')
        .eq('user_id', session.userId)
        .eq('report_date', today as string)
        .limit(1)
        .maybeSingle<{ id: string }>()
      reportId = old?.id ?? null
    } else if (lookupError) {
      return dbErrorResponse(lookupError)
    }

    if (reportId) {
      const { error } = await supabase.from('reports').update(fields).eq('id', reportId)
      if (error) return dbErrorResponse(error)
    } else {
      const row: Record<string, unknown> = legacy
        ? { ...fields }
        : {
            ...fields,
            scope: input.scope,
            store_visit_id: input.scope === 'store' ? input.store_visit_id : null,
            ...(input.report_date ? { report_date: input.report_date } : {}),
          }
      const { data, error } = await supabase
        .from('reports')
        .insert(row)
        .select('id')
        .single<{ id: string }>()
      if (error) {
        if (error.code === '23505') {
          return Response.json(
            {
              error:
                input.scope === 'store'
                  ? 'The report for this store is already filed. Open it to edit.'
                  : 'The whole-day report for that day is already filed. Open it to edit.',
            },
            { status: 409 },
          )
        }
        if (error.message.includes('Pick a store')) {
          return Response.json(
            { error: 'Pick a store you checked in at on that day.', code: 'store_visit' },
            { status: 400 },
          )
        }
        // The day rules (0094), in the database's own words.
        if (/day that has not come|up to \d+ days back|did not clock in or visit a store|report is closed/.test(error.message)) {
          return Response.json({ error: dbErrorMessage(error), code: 'report_day' }, { status: 400 })
        }
        return dbErrorResponse(error)
      }
      reportId = data.id
    }

    // Each photo is put on the report by the database (0067): one already
    // on today's report (a retry whose first answer was lost) is answered
    // with its row, never added twice; five at most; theirs, just uploaded.
    for (const [index, path] of [...new Set(input.photo_paths)].entries()) {
      const { error } = await supabase.rpc('add_report_photo', legacy ? { p_path: path } : { p_path: path, p_report: reportId })
      if (error) {
        return Response.json(
          { error: `Your report is saved, but photo ${index + 1} was not added: ${dbErrorMessage(error)}` },
          { status: 400 },
        )
      }
    }

    for (const file of input.files) {
      const { error } = await supabase.rpc(
        'add_report_file',
        legacy ? { p_path: file.path, p_name: file.name } : { p_path: file.path, p_name: file.name, p_report: reportId },
      )
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
