import { UserX } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'

export const metadata = { title: 'Account deactivated — Xtend' }

export default function DeactivatedPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-brand">
        <UserX className="h-6 w-6" />
      </span>
      <h1 className="text-xl font-extrabold">This account is deactivated</h1>
      <p className="text-sm text-muted-foreground">
        Speak to your administrator if you think this is a mistake.
      </p>
      <SignOutButton />
    </main>
  )
}
