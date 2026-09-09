import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { SignOutButton } from '@/components/sign-out-button'
import { FieldNav } from '@/components/field/field-nav'

export const dynamic = 'force-dynamic'

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['merchandiser', 'admin'])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Link href="/field" className="truncate text-sm font-semibold">
            {session.profile.full_name}
          </Link>
          <p className="text-xs text-muted-foreground">Xtend · Xpel Beauty</p>
        </div>
        <SignOutButton className="h-9 px-3 text-xs" />
      </header>

      <main className="flex-1 px-4 py-4">{children}</main>
      <FieldNav />
    </div>
  )
}
