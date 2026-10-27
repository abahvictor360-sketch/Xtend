import { lookupSummary } from '@/lib/place-resolve'

/**
 * How this month's place lookups were answered (migration 0068): from
 * Xtend's own list (stores, learned places, saved addresses, the server's
 * cache), by Google, or by OpenStreetMap; and how many requests went to
 * Google, against the monthly limit when one is set. Admins only.
 */
export function PlaceLookups({
  rows,
  limit,
}: {
  rows: { source: string; lookups: number }[]
  limit: number | null
}) {
  const s = lookupSummary(rows, limit)
  return (
    <section className="space-y-1.5 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-base font-bold">Place lookups this month</h2>
      {s.total === 0 ? (
        <p className="text-sm text-muted-foreground">None yet this month.</p>
      ) : (
        <p className="text-sm">
          Answered by Xtend&apos;s own list <strong>{s.own.toLocaleString()}</strong> ({s.ownPct}%), by Google{' '}
          <strong>{s.google.toLocaleString()}</strong> ({s.googlePct}%), by OpenStreetMap{' '}
          <strong>{s.osm.toLocaleString()}</strong> ({s.osmPct}%)
          {s.none > 0 && <>, not named {s.none.toLocaleString()}</>}.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Requests sent to Google (paid): {s.calls.toLocaleString()}
        {limit != null && (
          <>
            {' '}of a limit of {limit.toLocaleString()} a month
            {s.limitReached && <strong className="text-destructive">. Limit reached: OpenStreetMap is used until next month</strong>}
          </>
        )}
        . A spot named once is answered from Xtend&apos;s own list after that, without asking Google again.
      </p>
    </section>
  )
}
