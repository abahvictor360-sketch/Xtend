import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { recordActivity } from '@/lib/activity-server'
import { passwordIsRight } from '@/lib/password-check'
import { currentPasswordRequired } from '@/lib/password-gate'
import { allowAttempt } from '@/lib/rate-limit'

const schema = z.object({
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  /** Needed except for the first change after the office set the password. */
  current_password: z.string().max(200).optional(),
})

const WINDOW_MS = 15 * 60 * 1000

/**
 * The signed-in person sets their own password. Done here rather than in the
 * browser so the change is recorded with where it came from (migration 062).
 * Supabase still decides whether the new password is acceptable.
 *
 * Their current password must be given too, so a phone or computer left
 * signed in cannot be used to lock the owner out. The one exception is the
 * forced first change after an admin or supervisor set a temporary password:
 * they signed in with it moments ago.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(undefined, { allowDuringPasswordChange: true })
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Use at least 8 characters.' }, { status: 400 })
    }

    const forced = Boolean(session.profile.must_change_password)
    if (currentPasswordRequired(forced)) {
      const current = parsed.data.current_password ?? ''
      if (!current) {
        return Response.json({ error: 'Enter your current password.' }, { status: 400 })
      }
      if (!(await allowAttempt(`password-change:${session.userId}`, 10, WINDOW_MS))) {
        return Response.json({ error: 'Too many tries. Wait 15 minutes, then try again.' }, { status: 429 })
      }
      if (!session.email || !(await passwordIsRight(session.email, current))) {
        return Response.json({ error: 'Your current password is not correct.' }, { status: 400 })
      }
    }

    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
    if (error) return Response.json({ error: passwordProblem(error) }, { status: 400 })

    await supabase.from('profiles').update({ must_change_password: false }).eq('id', session.userId)
    await recordActivity(session.userId, 'password_changed', request.headers, {
      detail: forced ? { first: true } : {},
    })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}

/** Supabase's reason, in words for people; anything unexpected is logged. */
function passwordProblem(error: { code?: string; message: string }): string {
  const code = error.code ?? ''
  const text = error.message.toLowerCase()
  if (code === 'same_password' || text.includes('different from the old')) {
    return 'Choose a password you have not used here before.'
  }
  if (code === 'weak_password' || text.includes('weak') || text.includes('at least')) {
    return 'That password is too easy to guess. Try a longer one.'
  }
  console.error('password change refused', error)
  return 'The password could not be saved. Try again.'
}
