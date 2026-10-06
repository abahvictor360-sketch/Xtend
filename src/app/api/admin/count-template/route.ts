import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  path: z.string().min(1).max(300),
  file_name: z.string().max(200).default(''),
})

/**
 * Makes an uploaded PDF the count sheet staff download. Postgres checks the
 * caller is an admin and that the file is a PDF they just uploaded.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Choose the count sheet PDF' }, { status: 400 })
    if (!parsed.data.path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'That file does not belong to you' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('set_count_sheet_template', {
      p_path: parsed.data.path,
      p_file_name: parsed.data.file_name,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    await audit(supabase, 'count_sheet.template', 'count_sheet_templates', data as string, {
      file_name: parsed.data.file_name,
    })
    return Response.json({ id: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
