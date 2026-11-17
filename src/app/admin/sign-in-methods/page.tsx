import { requireSession } from '@/lib/auth'
import { QuickSignInSettings } from '@/components/quick-sign-in-settings'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fingerprint and passkeys — Xtend' }

/** The office's own fingerprint and passkey sign-ins (0089). */
export default async function SignInMethodsPage() {
  await requireSession(['admin', 'supervisor', 'hr'])
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Fingerprint and passkeys</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to Xtend without typing your password. If your role uses two-step sign-in, Xtend still
          asks for the code from your authenticator app.
        </p>
      </div>
      <QuickSignInSettings />
    </div>
  )
}
