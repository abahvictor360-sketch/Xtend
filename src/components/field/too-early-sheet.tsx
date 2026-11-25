'use client'

import { Clock, Store, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { tooEarlyWords } from '@/lib/clock-out-time'

/**
 * "It is not time to clock out yet" (0109): pops up when someone taps Clock
 * out before their clock-out time. A marketer is offered their store work
 * instead: check out of the store they are in, or check in at the next one.
 */
export function TooEarlySheet({
  opensAt,
  canVisitStores,
  openVisit,
  onStoreWork,
  onClose,
}: {
  opensAt: string | null
  canVisitStores: boolean
  /** The store they are checked in at now, if any. */
  openVisit: string | null
  onStoreWork?: () => void
  onClose: () => void
}) {
  if (!opensAt) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="too-early-title"
    >
      <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
            <Clock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="too-early-title" className="font-bold">
              Not time to clock out yet
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{tooEarlyWords(opensAt, canVisitStores, openVisit)}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-xl p-1 text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl bg-tint p-4 text-tint-foreground">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">You can clock out from</p>
          <p className="mt-1 text-2xl font-bold">{opensAt}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canVisitStores && onStoreWork && (
            <Button
              className="flex-1"
              onClick={() => {
                onClose()
                onStoreWork()
              }}
            >
              <Store className="h-4 w-4" /> {openVisit ? `Check out of ${openVisit}` : 'Check in at a store'}
            </Button>
          )}
          <Button variant={canVisitStores && onStoreWork ? 'outline' : 'default'} className="flex-1" onClick={onClose}>
            OK
          </Button>
        </div>
      </div>
    </div>
  )
}
