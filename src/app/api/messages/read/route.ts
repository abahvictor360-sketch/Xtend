import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { readMessagesSchema } from '@/lib/messages'

/** Marks a conversation read for the person looking at it (0073). */
export async function POST(request: Request) {
  try {
    await requireApiSession(['merchandiser', 'marketer', 'supervisor', 'admin', 'hr'])
    const parsed = readMessagesSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('read_messages', { p_staff: parsed.data.staff_id ?? null })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
