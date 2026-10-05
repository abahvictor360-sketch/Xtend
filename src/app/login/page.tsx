import { Suspense } from 'react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { Smartphone } from 'lucide-react'
import { LoginForm } from '@/app/login/login-form'
import { Skeleton } from '@/components/ui/skeleton'
import { XpelLockup, XpelTile } from '@/components/brand/logo'
import { isAppUserAgent } from '@/lib/app-agent'

export const metadata = { title: 'Sign in — Xtend' }

const REASONS: Record<string, string> = {
  'clocked-out': 'You have clocked out for today. Log in again when you next start work.',
  'new-day': 'A new day has started. Log in again to clock in.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const reason = (await searchParams).reason
  const notice = typeof reason === 'string' ? REASONS[reason] : undefined
  const inApp = isAppUserAgent((await headers()).get('user-agent'))

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
          {notice && (
            <p className="mb-5 rounded-2xl bg-tint px-4 py-3 text-sm text-tint-foreground">{notice}</p>
          )}

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <LoginForm />
          </Suspense>

          {!inApp && (
            <Link
              href="/download"
              className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-soft transition-colors hover:bg-tint"
            >
              <span className="icon-tile">
                <Smartphone className="h-5 w-5" />
              </span>
              <span className="flex-1 leading-tight">
                <span className="block text-sm font-bold">Get the Xtend app</span>
                <span className="block text-xs text-muted-foreground">For Android and iPhone</span>
              </span>
              <span aria-hidden className="text-lg font-bold text-brand">
                &rsaquo;
              </span>
            </Link>
          )}

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
