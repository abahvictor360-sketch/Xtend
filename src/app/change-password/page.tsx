import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { ChangePasswordForm } from '@/app/change-password/form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set your password — Xtend' }

export default async function ChangePasswordPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  const forced = session.profile.must_change_password

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="bg-brand px-6 pb-20 pt-14 text-white safe-top">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-[26px] font-extrabold leading-tight">
            {forced ? 'Set your password' : 'Change your password'}
          </h1>
          <p className="mt-2 text-sm text-white/80">
            {forced
              ? 'Your account was created with a temporary password. Choose your own before you start.'
              : 'Pick something you will remember. You will not be asked again.'}
          </p>
        </div>
      </div>

      <div className="-mt-10 flex-1 rounded-t-[2rem] bg-background px-6 pb-10 pt-8">
        <div className="mx-auto w-full max-w-sm">
          <ChangePasswordForm forced={forced} />
        </div>
      </div>
    </main>
  )
}
