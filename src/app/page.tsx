import { redirect } from 'next/navigation'
import { getSession, landingPathFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.profile.is_active) redirect('/deactivated')
  if (session.profile.must_change_password) redirect('/change-password')
  redirect(landingPathFor(session.profile.role))
}
