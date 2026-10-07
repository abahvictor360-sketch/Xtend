import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { fileName } from '@/lib/fields'

const schema = z.object({
  outlet_id: z.string().uuid(),
  path: z.string().min(1).max(300),
  file_name: fileName,
})

/**
 * A filled count sheet, already uploaded to the caller's folder. Whether a
 * count is due, whether the store is theirs, and what the file is are all
 * decided by submit_count_sheet() (migration 035).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'marketer', 'admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Choose the filled sheet to send' }, { status: 400 })
    if (!parsed.data.path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'That file does not belong to you' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('submit_count_sheet', {
      p_outlet_id: parsed.data.outlet_id,
      p_path: parsed.data.path,
      p_file_name: parsed.data.file_name,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    return Response.json({ id: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
