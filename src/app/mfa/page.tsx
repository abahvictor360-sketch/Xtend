import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { MfaShell } from '@/app/mfa/shell'
import { MfaChallenge } from '@/app/mfa/challenge'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enter your code — Xtend' }

/** Two-step sign-in (0080): the code from the authenticator app. */
export default async function MfaPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.mfa.step === 'setup') redirect('/mfa/setup')
  if (session.mfa.step !== 'challenge') redirect('/')

  return (
    <MfaShell
      title="Enter your code"
      intro="Open your authenticator app and type the 6-digit code it shows for Xtend."
    >
      <MfaChallenge />
    </MfaShell>
  )
}
