import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { OFFICE_ROLES } from '@/lib/zero-trust'
import { MfaShell } from '@/app/mfa/shell'
import { MfaSetup } from '@/app/mfa/setup/setup'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Two-step sign-in — Xtend' }

/**
 * Setting up two-step sign-in (0080): required for the roles in
 * mfa_roles (admins and HR), a choice for supervisors. Field staff are not
 * offered it.
 */
export default async function MfaSetupPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!OFFICE_ROLES.includes(session.profile.role)) redirect('/')
  if (session.mfa.step === 'challenge') redirect('/mfa')

  return (
    <MfaShell
      title="Two-step sign-in"
      intro={
        session.mfa.required
          ? 'Your account can change things for everyone, so it needs a code from your phone as well as your password.'
          : 'Add a code from your phone to your password, so nobody else can sign in as you.'
      }
    >
      <MfaSetup alreadyOn={session.mfa.enrolled} required={session.mfa.required} />
    </MfaShell>
  )
}
