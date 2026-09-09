import { SignOutButton } from '@/components/sign-out-button'

export const metadata = { title: 'Account deactivated — Xtend' }

export default function DeactivatedPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-5 text-center">
      <h1 className="text-xl font-semibold">This account is deactivated</h1>
      <p className="text-sm text-muted-foreground">
        Your attendance history is intact and still visible to your administrator. Speak to them if
        you think this is a mistake.
      </p>
      <SignOutButton />
    </main>
  )
}
