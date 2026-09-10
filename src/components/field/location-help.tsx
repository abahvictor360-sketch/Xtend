'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, ExternalLink, LocateFixed, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { detectPlatform, locationSteps, type Platform } from '@/lib/platform'
import { cn } from '@/lib/utils'

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

/**
 * Watches the browser's own record of the location permission, so the help
 * disappears the moment the user flips the switch in settings — without
 * them having to find their way back and press anything.
 */
export function useLocationPermission(): PermissionState {
  const [state, setState] = useState<PermissionState>('unknown')

  useEffect(() => {
    let status: PermissionStatus | null = null
    const onChange = () => setState((status?.state as PermissionState) ?? 'unknown')

    // Safari only gained the Permissions API for geolocation recently, so a
    // failure here is expected and simply means we show the steps anyway.
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        status = result
        setState(result.state as PermissionState)
        result.addEventListener('change', onChange)
      })
      .catch(() => setState('unknown'))

    return () => status?.removeEventListener('change', onChange)
  }, [])

  return state
}

/**
 * What to do when location is off.
 *
 * A web page cannot open the phone's Settings app: no browser exposes an
 * API for it, and the URL schemes that once worked were closed years ago.
 * So this does the two things that are actually possible — ask the browser
 * for permission again when it is still willing to prompt, and otherwise
 * name the exact screens and taps for this device — and it watches the
 * permission so it clears itself the instant location is allowed.
 */
export function LocationHelp({
  permission,
  onRetry,
  busy,
}: {
  permission: PermissionState
  onRetry: () => void
  busy?: boolean
}) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // The user agent is only available in the browser, so this waits a tick.
  useEffect(() => setPlatform(detectPlatform()), [])

  const sections = useMemo(() => (platform ? locationSteps(platform) : []), [platform])

  // Never asked, or the prompt was dismissed: the browser will still ask,
  // so there is no need to send anyone into Settings.
  const canPrompt = permission === 'prompt' || permission === 'unknown'

  useEffect(() => {
    if (permission === 'denied') setOpen(true)
  }, [permission])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-3">
      <Button className="w-full" size="lg" disabled={busy} onClick={onRetry}>
        <LocateFixed className="h-4 w-4" />
        {busy ? 'Checking…' : canPrompt ? 'Allow location' : 'Try again'}
      </Button>

      {canPrompt && (
        <p className="text-xs text-muted-foreground">
          Your {platform?.os === 'ios' ? 'iPhone' : 'phone'} will ask for permission. Choose
          <strong> Allow</strong> — Xtend only reads your location while you are using it.
        </p>
      )}

      {!canPrompt && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm font-semibold"
          >
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-brand" />
              How to turn location on{platform ? ` in ${platform.label}` : ''}
            </span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>

          {open && (
            <div className="space-y-4 rounded-2xl bg-muted p-4">
              {sections.map((section) => (
                <div key={section.title} className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {section.title}
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}

              <p className="text-xs leading-relaxed text-muted-foreground">
                Xtend cannot open Settings for you — a website is not allowed to. Leave this page
                open while you go; it will notice as soon as location is allowed.
              </p>

              <Button variant="outline" size="sm" className="w-full" onClick={() => void copyLink()}>
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Link copied' : 'Copy this page’s link'}
              </Button>
            </div>
          )}
        </>
      )}

      {platform?.os === 'ios' && !platform.installed && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Adding Xtend to your Home Screen gives it its own entry in iPhone Settings, which is
            far easier to change than Safari’s per-site permissions.
          </span>
        </p>
      )}
    </div>
  )
}
