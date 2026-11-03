'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { TURNSTILE_SCRIPT_URL } from '@/lib/turnstile'

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let scriptPromise: Promise<Turnstile> | null = null

/** Loads Cloudflare's script once; a failed load can be tried again. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile')))
    script.onerror = () => {
      script.remove()
      reject(new Error('load failed'))
    }
    document.head.appendChild(script)
  }).catch((error) => {
    scriptPromise = null
    throw error
  })
  return scriptPromise
}

export type HumanCheckHandle = { reset: () => void }

/**
 * Cloudflare Turnstile in "managed" mode with interaction-only appearance:
 * most people see nothing at all; a few are asked to tick a box. Hands its
 * token up through `onToken` (null when it expires or is used). If the
 * script cannot load (no data, a blocked network), it offers a retry
 * instead of leaving the person stuck.
 */
export const HumanCheck = forwardRef<HumanCheckHandle, { siteKey: string; onToken: (token: string | null) => void }>(
  function HumanCheck({ siteKey, onToken }, ref) {
    const box = useRef<HTMLDivElement>(null)
    const widget = useRef<string | null>(null)
    const tokenCallback = useRef(onToken)
    tokenCallback.current = onToken
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)

    useImperativeHandle(ref, () => ({
      reset: () => {
        tokenCallback.current(null)
        if (widget.current && window.turnstile) window.turnstile.reset(widget.current)
      },
    }))

    useEffect(() => {
      let cancelled = false
      loadTurnstile()
        .then((turnstile) => {
          if (cancelled || !box.current) return
          widget.current = turnstile.render(box.current, {
            sitekey: siteKey,
            action: 'sign-in',
            appearance: 'interaction-only',
            theme: 'light',
            callback: (token: string) => {
              setFailed(false)
              tokenCallback.current(token)
            },
            'expired-callback': () => tokenCallback.current(null),
            'error-callback': () => {
              tokenCallback.current(null)
              setFailed(true)
              return true
            },
          })
        })
        .catch(() => !cancelled && setFailed(true))
      return () => {
        cancelled = true
        if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
        widget.current = null
      }
    }, [siteKey, attempt])

    const retry = useCallback(() => {
      setFailed(false)
      setAttempt((n) => n + 1)
    }, [])

    return (
      <div>
        <div ref={box} className="flex justify-center empty:hidden" />
        {failed && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-tint px-4 py-3 text-sm text-tint-foreground">
            <span>The sign-in check did not load. Check your data, then try again.</span>
            <button
              type="button"
              onClick={retry}
              className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-brand"
            >
              <RotateCw className="h-4 w-4" /> Try again
            </button>
          </div>
        )}
      </div>
    )
  },
)
