import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { ChangePasswordForm } from '@/app/change-password/form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set your password — Xtend' }

export default async function ChangePasswordPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-xl font-semibold">
        {session.profile.must_change_password ? 'Set your password' : 'Change your password'}
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        {session.profile.must_change_password
          ? 'Your account was created with a temporary password. Choose your own before you start.'
          : 'Pick something you will remember. You will not be asked again.'}
      </p>
      <ChangePasswordForm forced={session.profile.must_change_password} />
    </main>
  )
}
