import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'

/**
 * The blank count sheet an admin uploaded (migration 035), for staff to
 * fill in. Anyone signed in may download it. The file sits in the admin's
 * folder, which staff cannot read, so it is fetched with the service role
 * once the table, read as the caller, has said which file it is.
 */
export async function GET() {
  try {
    await requireApiSession()
    const supabase = await createServerSupabase()
    const { data: template } = await supabase
      .from('count_sheet_templates')
      .select('path, file_name')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ path: string; file_name: string }>()
    if (!template) {
      return Response.json(
        { error: 'The office has not uploaded a count sheet yet.' },
        { status: 404 },
      )
    }

    const { data: file, error } = await createAdminSupabase()
      .storage.from('reports')
      .download(template.path)
    if (error || !file) {
      return Response.json({ error: 'The count sheet could not be loaded.' }, { status: 502 })
    }

    const name = template.file_name.replace(/[^\w .()-]+/g, '_')
    return new Response(file, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
