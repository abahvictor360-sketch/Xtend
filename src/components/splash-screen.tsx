'use client'

import { useEffect, useState } from 'react'

const SEEN = 'xtend-splash-seen'
/** Shortest time the splash stays up, so it reads as a splash and not a flicker. */
const MIN_MS = 700

/**
 * The screen between the phone's own launch screen and the first page. It is
 * drawn by the server with the page, so it is there before any script runs
 * (no white gap while the site loads), then fades out once the app is
 * ready. It shows once per visit: later reloads in the same session skip it.
 * Colours match the launch screen in mobile/assets/splash.png so the hand
 * over is seamless.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show')

  useEffect(() => {
    let seen = false
    try {
      seen = sessionStorage.getItem(SEEN) === '1'
      sessionStorage.setItem(SEEN, '1')
    } catch {
      // Storage blocked: show it, which is harmless.
    }
    if (seen) {
      setPhase('gone')
      return
    }
    const fade = setTimeout(() => setPhase('fade'), MIN_MS)
    const done = setTimeout(() => setPhase('gone'), MIN_MS + 400)
    return () => {
      clearTimeout(fade)
      clearTimeout(done)
    }
  }, [])

  if (phase === 'gone') return null
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#faf7f3] transition-opacity duration-300"
      style={{ opacity: phase === 'fade' ? 0 : 1, pointerEvents: phase === 'fade' ? 'none' : 'auto' }}
    >
      <svg viewBox="0 0 100 100" className="h-24 w-24 animate-pulse" fill="none" strokeLinecap="round" strokeWidth="11">
        <defs>
          <linearGradient id="xs-g" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#c45a2a" />
            <stop offset="1" stopColor="#c8921f" />
          </linearGradient>
        </defs>
        <path d="M24 82 C42 56 62 36 82 16" stroke="url(#xs-g)" />
        <path d="M26 16 C38 44 56 66 78 84" stroke="url(#xs-g)" />
      </svg>
      <p className="mt-5 text-2xl font-extrabold tracking-tight text-[#2a1f1a]">Xtend</p>
      <p className="mt-1 text-xs text-[#8a7a70]">Xpel Beauty</p>
    </div>
  )
}
