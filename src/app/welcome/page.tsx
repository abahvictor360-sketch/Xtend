import { redirect } from 'next/navigation'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { avatarUrls } from '@/lib/avatars'
import { Onboarding } from '@/components/field/onboarding'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Welcome — Xtend' }

/** The first-run walkthrough for new field staff (035). Shown once. */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ again?: string }>
}) {
  const session = await requireSession(FIELD_ROLES)
  const { again } = await searchParams
  // Done already, and not asked to see it again: straight to the app.
  if (session.profile.onboarded_at && again !== '1') redirect('/field')

  const supabase = await createServerSupabase()
  const photo = (await avatarUrls(supabase, [session.userId])).get(session.userId) ?? null

  return (
    <div className="field-shell min-h-dvh bg-background">
      <Onboarding name={session.profile.full_name} photoUrl={photo} />
    </div>
  )
}
