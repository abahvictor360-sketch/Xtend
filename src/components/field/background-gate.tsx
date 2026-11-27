'use client'

import { useCallback, useEffect, useState } from 'react'
import { lagosDateString } from '@/lib/utils'
import { BatteryWarning, CheckCircle2, Lock, MapPin, PlayCircle, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { askAlwaysLocation, hasShiftTracker, openAutoStart, openBatterySettings, shiftTrackerState } from '@/lib/native'
import { backgroundNeeds, strictMaker, type BackgroundNeeds, type BackgroundState } from '@/lib/background-gate'
import { TECNO_VIDEO } from '@/lib/tecno-video'
import { whenVisible } from '@/lib/visible'

const CONFIRM_KEY = 'xtend-battery-confirmed'
/** TECNO, Infinix, itel: Auto-start and the lock confirmed on this phone (kept until the app is reinstalled). */
const MAKER_KEY = 'xtend-maker-setup-v1'

/**
 * Reads the phone app's settings and keeps them current: when the page opens,
 * when the app comes back to the screen (from the phone's Settings), and
 * every few seconds while something is still missing, since some phones do
 * not announce the return. Nothing in a browser or an app without the
 * tracker: `checked` is true and nothing is demanded.
 */
export function useBackgroundNeeds() {
  const [state, setState] = useState<BackgroundState | null>(null)
  const [checked, setChecked] = useState(!hasShiftTracker())
  // "I turned battery saving off", good for today only.
  const [batteryConfirmed, setBatteryConfirmed] = useState(false)
  // TECNO, Infinix, itel: "I turned on Auto-start and locked Xtend", once per phone.
  const [makerConfirmed, setMakerConfirmed] = useState(false)
  useEffect(() => {
    try {
      setBatteryConfirmed(localStorage.getItem(CONFIRM_KEY) === lagosDateString())
      setMakerConfirmed(Boolean(localStorage.getItem(MAKER_KEY)))
    } catch {
      // Storage blocked: the step simply stays required.
    }
  }, [])
  const confirmMaker = useCallback(() => {
    try {
      localStorage.setItem(MAKER_KEY, new Date().toISOString())
    } catch {
      // Still allowed for this visit.
    }
    setMakerConfirmed(true)
  }, [])
  const confirmBattery = useCallback(() => {
    try {
      localStorage.setItem(CONFIRM_KEY, lagosDateString())
    } catch {
      // Still allowed for this visit.
    }
    setBatteryConfirmed(true)
  }, [])

  const recheck = useCallback(async () => {
    if (!hasShiftTracker()) return
    setState(await shiftTrackerState())
    setChecked(true)
  }, [])

  useEffect(() => {
    void recheck()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [recheck])

  const needs = backgroundNeeds(state, { batteryConfirmed, makerConfirmed })
  useEffect(() => {
    if (!needs.blocked) return
    const timer = window.setInterval(whenVisible(() => void recheck()), 3000)
    return () => window.clearInterval(timer)
  }, [needs.blocked, recheck])

  return { state, needs, checked, recheck, confirmBattery, confirmMaker }
}

/**
 * Shown in place of the clock button until the phone app is allowed to keep
 * running. Plain steps for each setting, a button that opens the right phone
 * screen, and a tick that appears as soon as it is done. It clears itself.
 */
export function BackgroundGate({
  state,
  needs,
  action,
  onDone,
  onConfirmBattery,
  onConfirmMaker,
}: {
  state: BackgroundState | null
  needs: BackgroundNeeds
  /** "clock in" or "clock out". */
  action: string
  onDone: () => void
  /** Phones that cannot report the battery setting: the person says it is off. */
  onConfirmBattery?: () => void
  /** TECNO, Infinix, itel: the person says Auto-start is on and Xtend is locked. */
  onConfirmMaker?: () => void
}) {
  const ios = state?.platform === 'ios'
  const maker = strictMaker(state)
  // The 1½-minute video of the TECNO / Infinix / itel steps, opened here.
  const [watching, setWatching] = useState(false)
  return (
    <Card className="animate-fade-up border border-warning/40">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="icon-tile bg-warning/15 text-warning">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold">Finish setting up Xtend to {action}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Xtend needs {ios ? 'this setting' : 'these settings'} before you can {action}. It clears
              by itself when you come back.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            {needs.always ? (
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            )}
            <div className="flex-1 space-y-1.5 text-sm">
              <p className={needs.always ? 'font-semibold' : 'text-muted-foreground'}>
                {ios ? 'Location: Always' : 'Location: Allow all the time'}
                {needs.always ? '' : ' (done)'}
              </p>
              {needs.always && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {ios
                      ? 'In Settings, open Xtend, then Location, and choose “Always”.'
                      : 'Open Permissions, then Location, and choose “Allow all the time”.'}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => void askAlwaysLocation().then(onDone)}>
                    {ios ? 'Allow always' : 'Open location settings'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {!ios && (
            <div className="flex items-start gap-2">
              {needs.battery ? (
                <BatteryWarning className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              )}
              <div className="flex-1 space-y-1.5 text-sm">
                <p className={needs.battery ? 'font-semibold' : 'text-muted-foreground'}>
                  Battery: Unrestricted{needs.battery ? '' : ' (done)'}
                </p>
                {needs.battery && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Find Xtend in the list and choose “Don’t optimise” or “Unrestricted”. On TECNO,
                      Infinix and Xiaomi phones, also allow Xtend to Auto-start and set its battery use
                      to “No restrictions”.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void openBatterySettings().then(onDone)}>
                      Open battery settings
                    </Button>
                    {onConfirmBattery && (
                      <>
                        <p className="pt-1 text-xs text-muted-foreground">
                          Already set it, but this still shows? Some phones cannot report it.
                        </p>
                        <Button size="sm" variant="ghost" onClick={onConfirmBattery}>
                          I turned it off, continue
                        </Button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {maker && needs.maker && (
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 space-y-1.5 text-sm">
                <p className="font-semibold">On your {maker} phone: Auto-start and lock Xtend</p>
                <p className="text-xs text-muted-foreground">
                  {maker} phones close apps by themselves to save battery. Do both steps once, so Xtend keeps working
                  when your screen is off.
                </p>
                <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>
                    Tap <span className="font-semibold text-foreground">Open Auto-start</span>, find Xtend and turn it on.
                    (Or open Phone Master, then App management or Auto-start, and turn on Xtend.)
                  </li>
                  <li>
                    Open your recent apps (the square button, or swipe up from the bottom and hold), find Xtend and pull
                    it down until a lock shows on it.
                  </li>
                  <li>
                    Come back here and tap <span className="font-semibold text-foreground">I did both</span>.
                  </li>
                </ol>
                {watching ? (
                  <video
                    src={TECNO_VIDEO.src}
                    poster={TECNO_VIDEO.poster}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="mx-auto w-full max-w-[260px] rounded-2xl bg-black"
                  />
                ) : (
                  <Button size="sm" variant="ghost" className="px-0 text-brand" onClick={() => setWatching(true)}>
                    <PlayCircle className="h-4 w-4" /> Watch how ({Math.round(TECNO_VIDEO.seconds / 30) / 2} min)
                  </Button>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => void openAutoStart().then(onDone)}>
                    Open Auto-start
                  </Button>
                  {onConfirmMaker && (
                    <Button size="sm" onClick={onConfirmMaker}>
                      I did both
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
