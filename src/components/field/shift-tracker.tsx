'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BatteryWarning, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  askAlwaysLocation,
  hasShiftTracker,
  openBatterySettings,
  shiftTrackerState,
  startShiftTracker,
  stopShiftTracker,
  type ShiftTrackerState,
} from '@/lib/native'

/**
 * In the Xtend app: keeps the native shift tracker running for the length
 * of the shift, so location is shared even with the app closed, and stops
 * it at clock-out. Shows a short note only when the phone needs a setting
 * changed for that to work. Nothing in a browser.
 */
export function ShiftTracker({ onShift, clockedOut }: { onShift: boolean; clockedOut: boolean }) {
  const [state, setState] = useState<ShiftTrackerState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const starting = useRef(false)
  // Bumped when the app comes back to the screen, to try again (a clock-in
  // made without network has no tracking token until the network is back).
  const [visible, setVisible] = useState(0)

  const refresh = useCallback(async () => {
    setState(await shiftTrackerState())
  }, [])

  // On shift: make sure it is running (a new token each shift; again if
  // Android stopped it or the phone restarted without permission to resume).
  useEffect(() => {
    if (!onShift || !hasShiftTracker() || starting.current) return
    let cancelled = false
    void (async () => {
      const now = await shiftTrackerState()
      if (cancelled) return
      if (now?.active && now.running) {
        setState(now)
        return
      }
      starting.current = true
      try {
        const started = await startShiftTracker()
        if (!cancelled) {
          setState(started)
          setProblem(null)
        }
      } catch (e) {
        if (!cancelled) setProblem(e instanceof Error ? e.message : 'Location could not be started')
      } finally {
        starting.current = false
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onShift, visible])

  // Clocked out: stop at once rather than waiting for the server to say so.
  useEffect(() => {
    if (clockedOut && hasShiftTracker()) void stopShiftTracker().then(refresh)
  }, [clockedOut, refresh])

  // Back from the phone's settings: show what changed.
  useEffect(() => {
    if (!hasShiftTracker()) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        setVisible((n) => n + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  if (!onShift || !state) {
    return problem && onShift ? <p className="text-xs text-destructive">{problem}</p> : null
  }
  const needsAlways = !state.always
  const needsBattery = state.platform === 'android' && !state.batteryUnrestricted
  if (!needsAlways && !needsBattery) return null

  return (
    <div className="space-y-2 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="font-semibold">Keep sharing your location when Xtend is closed</p>
      {needsAlways && (
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <p>
              {state.platform === 'ios'
                ? 'Set Location to “Always” for Xtend, so your shift is recorded even after you close the app.'
                : 'Set Location to “Allow all the time” for Xtend, so your shift carries on after the phone restarts.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => void askAlwaysLocation().then(refresh)}>
              {state.platform === 'ios' ? 'Allow always' : 'Open location settings'}
            </Button>
          </div>
        </div>
      )}
      {needsBattery && (
        <div className="flex items-start gap-2">
          <BatteryWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <p>Let Xtend run without battery restrictions, or the phone may stop it during your shift.</p>
            <Button size="sm" variant="outline" onClick={() => void openBatterySettings().then(refresh)}>
              Open battery settings
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
