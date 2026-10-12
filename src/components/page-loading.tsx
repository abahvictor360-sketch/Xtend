/** Server-rendered feedback while the requested screen fetches its data. */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4 py-6">
      <p className="text-sm text-muted-foreground">Loading page…</p>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-8 w-40 rounded-lg bg-muted" />
        <div className="h-28 rounded-2xl bg-muted" />
        <div className="h-28 rounded-2xl bg-muted" />
      </div>
    </div>
  )
}
