import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Smartphone } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { appOnlyBlocks } from '@/lib/app-only'
import { buttonVariants } from '@/components/ui/button'
import { SignOutButton } from '@/components/sign-out-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Use the Xtend app — Xtend' }

/**
 * Where someone an admin made app-only (migration 0084) lands when they open
 * Xtend in a browser. Anyone else, and anyone in the app, is sent on.
 * Uses getSession (not requireSession), which would send them straight back.
 */
export default async function AppOnlyPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!appOnlyBlocks(session.profile, (await headers()).get('user-agent'))) redirect('/')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6 pb-[10vh] text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-brand">
        <Smartphone className="h-6 w-6" />
      </span>
      <h1 className="text-xl font-extrabold">Use the Xtend app</h1>
      <p className="text-sm text-muted-foreground">
        Your account works in the Xtend phone app only. Download it, open it, and sign in there with the
        same phone number and password.
      </p>
      <Link href="/download" className={buttonVariants({ size: 'lg' })}>
        Download the app
      </Link>
      <SignOutButton />
    </main>
  )
}
