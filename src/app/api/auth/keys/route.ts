import { apiError, requireApiSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'

/** The person's own fingerprint and passkey sign-ins (0089). Empty before it runs. */
export async function GET() {
  try {
    await requireApiSession()
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('my_sign_in_keys')
    if (error) return Response.json({ keys: [], available: false })
    return Response.json({ keys: data ?? [], available: true })
  } catch (error) {
    return apiError(error)
  }
}
