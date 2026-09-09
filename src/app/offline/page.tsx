export const metadata = { title: 'Offline — Xtend' }

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-3 px-5 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="text-sm text-muted-foreground">
        Anything you saved while offline is queued on this phone and will be sent the moment you
        have data. Nothing is lost.
      </p>
    </main>
  )
}
