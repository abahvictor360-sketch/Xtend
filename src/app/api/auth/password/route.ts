import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { recordActivity } from '@/lib/activity-server'

const schema = z.object({
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
})

/**
 * The signed-in person sets their own password. Done here rather than in the
 * browser so the change is recorded with where it came from (migration 062).
 * Supabase still decides whether the new password is acceptable.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Use at least 8 characters.' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
    if (error) return Response.json({ error: error.message }, { status: 400 })

    await supabase.from('profiles').update({ must_change_password: false }).eq('id', session.userId)
    await recordActivity(session.userId, 'password_changed', request.headers, {
      detail: session.profile.must_change_password ? { first: true } : {},
    })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
