'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { callNative, hasPlugin, nativePlatform } from '@/lib/native'
import {
  buildNumber,
  decideUpdate,
  shouldShowNotes,
  type ReleaseNote,
  type UpdateState,
  type VersionInfo,
} from '@/lib/app-update'

const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? ''
const CHECK_EVERY_MS = 10 * 60_000
const SNOOZE_SITE_MS = 30 * 60_000
const SNOOZE_APP_MS = 24 * 3_600_000

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: the prompt simply comes back sooner.
  }
}

/** Reloads onto the new version, with a fresh service worker. */
async function applySiteUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch {
    // The reload alone still loads the new pages.
  }
  window.location.reload()
}

/**
 * Keeps every phone and browser on the newest Xtend.
 *
 * The site: checks /api/version when the page opens, every ten minutes,
 * and whenever the app comes back to the screen. A newer deploy shows a
 * bar with "Update now" (a reload: anything waiting to upload stays in the
 * phone's outbox); when an admin marked the update as required, the page
 * cannot be used until it is updated. A page left open across a deploy
 * that fails to load its next screen reloads itself.
 *
 * The phone app: inside the Android or iPhone app, compares the installed
 * build with the newest and offers the download; below the lowest build an
 * admin allows, it must be installed before carrying on.
 *
 * After an update, the admin's "What's new" note is shown once.
 */
export function UpdateManager() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [note, setNote] = useState<ReleaseNote | null>(null)
  const [, force] = useState(0)
  const lastCheck = useRef(0)
  const reported = useRef<string | null>(null)

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < 60_000) return
    lastCheck.current = Date.now()
    let info: VersionInfo
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      info = (await res.json()) as VersionInfo
    } catch {
      return
    }

    const platform = nativePlatform()
    let appVersion: string | null = null
    let appBuild: number | null = null
    if (platform && hasPlugin('App')) {
      try {
        const got = await callNative<{ version?: string; build?: string }>('App', 'getInfo')
        appVersion = got.version ?? null
        appBuild = buildNumber(got.build) ?? buildNumber(got.version)
      } catch {
        // An older app without the plugin: only the site is checked.
      }
    }

    const decided = decideUpdate(info, { build: MY_BUILD, platform, appBuild })
    setState(decided)
    if (decided.site === 'current' && shouldShowNotes(info.release, read('xt_seen_release'))) setNote(info.release)

    // Tell the office which version this person is on (once per change).
    const key = `${platform ?? 'web'}|${appBuild}|${MY_BUILD}`
    if (reported.current !== key) {
      reported.current = key
      void fetch('/api/version/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platform ?? 'web', app_version: appVersion, app_build: appBuild, web_build: MY_BUILD || null }),
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    void check()
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    // A page from before a deploy asks for code the server no longer has:
    // reload once onto the new version rather than show a broken screen.
    const onChunkError = (e: ErrorEvent | PromiseRejectionEvent) => {
      const reason = 'reason' in e ? e.reason : e.error
      const text = String((reason as Error)?.name ?? '') + String((reason as Error)?.message ?? e)
      if (!/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(text)) return
      const last = Number(read('xt_chunk_reload') ?? 0)
      if (Date.now() - last < 60_000) return
      write('xt_chunk_reload', String(Date.now()))
      window.location.reload()
    }
    window.addEventListener('error', onChunkError)
    window.addEventListener('unhandledrejection', onChunkError)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener('error', onChunkError)
      window.removeEventListener('unhandledrejection', onChunkError)
    }
  }, [check])

  if (!state) return null
  const now = Date.now()

  // Must update before carrying on.
  if (state.app === 'required' || state.site === 'required') {
    const app = state.app === 'required'
    return (
      <div role="alertdialog" aria-modal="true" aria-labelledby="xt-update-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur">
        <div className="w-full max-w-sm space-y-4 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-brand">
            {app ? <Download className="h-7 w-7" /> : <RefreshCw className="h-7 w-7" />}
          </span>
          <h2 id="xt-update-title" className="text-xl font-bold">
            {app ? 'Install the new Xtend app' : 'Update Xtend to carry on'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {app
              ? 'This version of the app is too old to keep using. Install the new one; your account and anything waiting to upload are kept.'
              : 'A required update is ready. It takes a few seconds; anything waiting to upload is kept.'}
          </p>
          {app ? (
            <a href={state.appUrl!} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-primary-foreground">
              <Download className="h-4 w-4" /> Get the new app
            </a>
          ) : (
            <Button className="h-11 w-full" onClick={() => void applySiteUpdate()}>
              <RefreshCw className="h-4 w-4" /> Update now
            </Button>
          )}
        </div>
      </div>
    )
  }

  const siteSnoozed = now - Number(read('xt_snooze_site') ?? 0) < SNOOZE_SITE_MS
  const appSnoozed = now - Number(read('xt_snooze_app') ?? 0) < SNOOZE_APP_MS

  return (
    <>
      {state.site === 'available' && !siteSnoozed && (
        <Bar
          icon={<RefreshCw className="h-4 w-4" />}
          text="A new version of Xtend is ready."
          action={
            <Button size="sm" variant="secondary" className="h-8" onClick={() => void applySiteUpdate()}>
              Update now
            </Button>
          }
          onClose={() => {
            write('xt_snooze_site', String(Date.now()))
            force((n) => n + 1)
          }}
        />
      )}
      {state.site === 'current' && state.app === 'available' && !appSnoozed && (
        <Bar
          icon={<Download className="h-4 w-4" />}
          text={`A new Xtend app${state.appVersion ? ` (${state.appVersion})` : ''} is ready to install.`}
          action={
            <a href={state.appUrl!} className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-xs font-semibold text-brand-ink">
              Get it
            </a>
          }
          onClose={() => {
            write('xt_snooze_app', String(Date.now()))
            force((n) => n + 1)
          }}
        />
      )}
      {note && (
        <div role="dialog" aria-modal="true" aria-labelledby="xt-notes-title" className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-card p-5 shadow-xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
              <Sparkles className="h-4 w-4" /> What&apos;s new in Xtend
            </p>
            <h2 id="xt-notes-title" className="text-lg font-bold">
              {note.title}
            </h2>
            {note.notes && (
              <div className="max-h-[50vh] space-y-2 overflow-y-auto whitespace-pre-line text-sm text-muted-foreground">{note.notes}</div>
            )}
            <Button
              className="w-full"
              onClick={() => {
                write('xt_seen_release', note.id)
                setNote(null)
              }}
            >
              Got it
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function Bar({ icon, text, action, onClose }: { icon: React.ReactNode; text: string; action: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#52281a] px-4 py-3 text-sm text-white shadow-lg sm:bottom-6"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{text}</span>
      {action}
      <button type="button" aria-label="Later" onClick={onClose} className="shrink-0 rounded-full p-1 text-white/70 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
