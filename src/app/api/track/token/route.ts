import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'

const schema = z.object({ platform: z.enum(['android', 'ios']) })

/**
 * A tracking token for this phone, asked for by the Xtend app when a shift
 * starts. The app's native tracker sends positions with it to
 * /api/track/device, so tracking carries on with the app closed, when the
 * web page and its sign-in are gone (migration 050).
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Say which phone' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('issue_tracking_token', { p_platform: parsed.data.platform })
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      return Response.json({ error: dbErrorMessage(error) }, { status: missing ? 503 : 400 })
    }
    const got = data as { token: string; expires_at: string }
    return Response.json({
      token: got.token,
      expires_at: got.expires_at,
      endpoint: new URL('/api/track/device', request.url).toString(),
    })
  } catch (error) {
    return apiError(error)
  }
}
