'use client'

import { AlertTriangle, Radio, RefreshCw, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatLagos, metres } from '@/lib/utils'
import type { HeartbeatStatus } from '@/components/field/heartbeat'
import type { Coverage } from '@/lib/types'

function minutes(seconds: number | null | undefined) {
  if (!seconds) return '0 min'
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * What the heartbeat is doing, what it covered today, and — stated rather
 * than buried — what it cannot do.
 */
export function TrackingPanel({
  onShift,
  status,
  coverage,
}: {
  onShift: boolean
  status: HeartbeatStatus
  coverage: Coverage | null
}) {
  const pct = coverage?.coverage_pct ?? null

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-center gap-3">
            <span className={`icon-tile ${onShift ? '' : 'bg-muted text-muted-foreground'}`}>
              <Radio className={`h-5 w-5 ${onShift && status.sending ? 'animate-pulse' : ''}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                {onShift ? 'Checking every 5 minutes' : 'Not running'}
              </p>
              <p className="text-xs text-muted-foreground">
                {onShift
                  ? status.lastPingAt
                    ? `Last check ${formatLagos(status.lastPingAt, false)}${
                        status.lastDistanceM !== null
                          ? ` · ${metres(status.lastDistanceM)} from where you clocked in`
                          : ''
                      }`
                    : 'Waiting for the first check…'
                  : 'Tracking starts when you clock in.'}
              </p>
            </div>
            {onShift && (
              <Button
                size="iconSm"
                variant="secondary"
                aria-label="Check now"
                onClick={status.pingNow}
                disabled={status.sending}
              >
                <RefreshCw className={`h-4 w-4 ${status.sending ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </div>

          {status.lastError && (
            <p className="flex items-start gap-1.5 rounded-2xl bg-warning/12 p-3 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              {status.lastError}
            </p>
          )}

          {coverage && coverage.ping_count > 0 && (
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">Tracked today</span>
                <span className="text-muted-foreground">
                  {minutes(coverage.tracked_seconds)} of {minutes(coverage.shift_seconds)}
                  {pct !== null && ` · ${pct}%`}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${
                    pct !== null && pct >= 70 ? 'bg-success' : 'bg-warning'
                  }`}
                  style={{ width: `${Math.max(2, pct ?? 0)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {coverage.ping_count} location check{coverage.ping_count === 1 ? '' : 's'} so far
                today. Your admin sees this same figure.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keeping the screen awake is the only lever the web actually gives us. */}
      <Card>
        <CardContent className="pt-5">
          <label className="flex items-start gap-3">
            <span className="icon-tile">
              <Smartphone className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-bold">
                Keep the screen awake on shift
                {status.wakeLock === 'held' && <Badge variant="success">On</Badge>}
                {status.wakeLock === 'unsupported' && <Badge variant="outline">Not supported</Badge>}
                {status.wakeLock === 'denied' && <Badge variant="warning">Blocked</Badge>}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Holds the screen on while you are on shift so location checks keep running
                without interruption. Uses a little more battery.
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--brand))]"
              checked={status.keepAwake}
              disabled={status.wakeLock === 'unsupported'}
              onChange={(e) => status.setKeepAwake(e.target.checked)}
            />
          </label>
        </CardContent>
      </Card>

    </div>
  )
}
