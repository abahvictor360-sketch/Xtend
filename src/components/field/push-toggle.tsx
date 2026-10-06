'use client'

import { Bell, BellOff, BellRing } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { usePush } from '@/components/field/use-push'

/**
 * One switch for this device's notifications: on the staff account screen,
 * and on the dashboard's Alerts page, where it is what lets an admin or
 * supervisor be told about their staff at all.
 */
export function PushToggle({
  title = 'Notifications',
  hint,
}: {
  title?: string
  /** What turning it on gets you; shown while it is off. */
  hint?: string
} = {}) {
  const { state, error, enable, disable } = usePush()

  const label =
    state === 'on'
      ? 'On for this device'
      : state === 'denied'
        ? 'Blocked in your browser settings'
        : state === 'unsupported'
          ? 'Not supported by this browser'
          : state === 'unconfigured'
            ? 'Not switched on by your admin yet'
            : state === 'working'
              ? 'Checking…'
              : 'Off'

  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-5">
        <span className={`icon-tile ${state === 'on' ? '' : 'bg-muted text-muted-foreground'}`}>
          {state === 'on' ? (
            <BellRing className="h-5 w-5" />
          ) : state === 'denied' ? (
            <BellOff className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-bold">
            {title}
            {state === 'on' && <Badge variant="success">On</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
          {hint && state === 'off' && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          {state === 'denied' && (
            <p className="mt-1 text-xs text-muted-foreground">
              Open your browser settings for this site and set Notifications to Allow.
            </p>
          )}
        </div>

        {(state === 'off' || state === 'on') && (
          <Button
            size="sm"
            variant={state === 'on' ? 'outline' : 'default'}
            onClick={() => void (state === 'on' ? disable() : enable())}
          >
            {state === 'on' ? 'Turn off' : 'Turn on'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
