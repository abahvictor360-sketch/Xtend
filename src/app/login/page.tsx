import { Suspense } from 'react'
import { LoginForm } from '@/app/login/login-form'
import { Skeleton } from '@/components/ui/skeleton'
import { XpelLockup, XpelTile } from '@/components/brand/logo'

export const metadata = { title: 'Sign in — Xtend' }

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Brand block up top, white sheet over it: the same shape as the
          in-app sheet screens, so signing in feels like the app already. */}
      <div className="bg-brand px-6 pb-20 pt-16 text-white safe-top">
        <div className="mx-auto w-full max-w-sm">
          <XpelTile />
          <h1 className="mt-6 text-[30px] font-extrabold leading-tight">Xtend</h1>
          <p className="mt-1 text-sm text-white/80">
            Field attendance for Xpel Beauty. Clock in, report, go.
          </p>
        </div>
      </div>

      <div className="-mt-10 flex-1 rounded-t-[2rem] bg-background px-6 pb-10 pt-8">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-lg font-bold">Sign in</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">
            Use the email or phone number your admin registered.
          </p>

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <LoginForm />
          </Suspense>

          <div className="mt-10 flex flex-col items-center gap-3">
            <XpelLockup width={140} className="opacity-90" />
            <p className="text-center text-xs text-muted-foreground">
              Accounts are created by an administrator. There is no public signup.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
