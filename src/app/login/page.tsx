import { Suspense } from 'react'
import { LoginForm } from '@/app/login/login-form'
import { Skeleton } from '@/components/ui/skeleton'

export const metadata = { title: 'Sign in — Xtend' }

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground">
          X
        </div>
        <h1 className="text-xl font-semibold">Xtend</h1>
        <p className="text-sm text-muted-foreground">Xpel Beauty field attendance</p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <LoginForm />
      </Suspense>
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Accounts are created by an administrator. There is no public signup.
      </p>
    </main>
  )
}
