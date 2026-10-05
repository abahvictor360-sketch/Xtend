'use client'

import { BellRing, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { usePush } from '@/components/field/use-push'
import { isNativeApp } from '@/lib/native'

/**
 * Stands in for the clock-in button until notifications are on for this
 * phone. The database refuses a clock-in without them (migration 027);
 * this says why, and turns them on in one tap where the browser allows.
 */
export function NotificationGate({ push }: { push: ReturnType<typeof usePush> }) {
  const { state, error, enable } = push
  const iPhone = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)

  return (
    <Card className="border-brand/40">
      <CardContent className="space-y-3 pt-5 text-sm">
        <p className="flex items-center gap-2 font-bold">
          <BellRing className="h-5 w-5 text-brand" />
          Turn on notifications to clock in
        </p>
        <p className="text-muted-foreground">
          Xtend needs to reach you during your shift, so clocking in needs notifications turned on
          for Xtend on this phone.
        </p>

        {state === 'off' && (
          <Button size="xl" className="w-full" onClick={() => void enable()}>
            <BellRing className="h-5 w-5" />
            Turn on notifications
          </Button>
        )}
        {state === 'working' && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </p>
        )}
        {state === 'denied' && (
          <div className="space-y-1 rounded-2xl bg-muted p-3">
            <p className="font-semibold">Notifications are blocked for Xtend</p>
            <p className="text-muted-foreground">
              {isNativeApp()
                ? "Open your phone's Settings, then Apps (or Notifications on iPhone), then Xtend, and turn Notifications on. Then come back here."
                : null}
            </p>
            <p className={isNativeApp() ? 'hidden' : 'text-muted-foreground'}>
              Tap the lock or settings icon next to the web address (or open your phone&apos;s
              Settings, then Apps, then Chrome or Xtend), choose Notifications, and set it to
              Allow. Then come back here and pull down to refresh.
            </p>
          </div>
        )}
        {state === 'unsupported' && (
          <div className="space-y-1 rounded-2xl bg-muted p-3">
            <p className="font-semibold">This browser cannot receive notifications</p>
            <p className="text-muted-foreground">
              {iPhone
                ? 'On iPhone: tap Share, then "Add to Home Screen", and open Xtend from the new icon. Then turn notifications on here.'
                : 'Open Xtend in Chrome on this phone, then turn notifications on here.'}{' '}
              If it still does not work, ask your admin.
            </p>
          </div>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
