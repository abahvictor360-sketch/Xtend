/**
 * For timers that only matter while someone is looking (2026-11-27): the
 * tick is skipped while the app is in the background, so a phone in a
 * pocket is not woken every few seconds to read storage for nothing. Each
 * timer still runs straight away when the app comes back (its own focus,
 * online or visibility handler, or its next tick).
 */
export function onScreen(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

export function whenVisible<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    if (onScreen()) fn(...args)
  }
}

/**
 * Runs fn every ms while the app is on screen, and at once when it comes
 * back. Returns the clean-up for a React effect.
 */
export function everyWhileVisible(fn: () => void, ms: number): () => void {
  const timer = setInterval(whenVisible(fn), ms)
  const onBack = () => {
    if (onScreen()) fn()
  }
  document.addEventListener('visibilitychange', onBack)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onBack)
  }
}
