import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'

/** Clock-out from the app: this person's tracking tokens stop at once. */
export async function POST() {
  try {
    await requireApiSession(FIELD_ROLES)
    const supabase = await createServerSupabase()
    await supabase.rpc('revoke_tracking_tokens')
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
