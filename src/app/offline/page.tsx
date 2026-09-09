import { WifiOff } from 'lucide-react'

export const metadata = { title: 'Offline — Xtend' }

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-brand">
        <WifiOff className="h-6 w-6" />
      </span>
      <h1 className="text-xl font-extrabold">You are offline</h1>
      <p className="text-sm text-muted-foreground">
        Anything you saved while offline is queued on this phone and will be sent the moment you
        have data. Nothing is lost.
      </p>
    </main>
  )
}
