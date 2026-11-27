/**
 * Errors in the browser that do not crash a screen (a failed promise, a
 * script error in the background) were never seen by anyone. Now they are
 * reported to /api/client-error as "background" (2026-11-27) and show on
 * System → Problems. Noise is left out, the same message is sent once per
 * page load, and at most five per page load. Pure parts here, for
 * scripts/check-error-handling.ts; the listener is ErrorReporter.
 */

/** Not worth reporting: browser quirks, extensions, a lost connection, an update in progress. */
const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /AbortError|The (user|operation) aborted|signal is aborted/i,
  /Failed to fetch|NetworkError|Load failed|network connection was lost|Network request failed/i,
  /ChunkLoadError|Loading chunk|dynamically imported module/i,
  /extension:\/\/|chrome-extension|moz-extension|safari-web-extension/i,
  /Non-Error promise rejection captured/i,
]

export function isNoise(message: string, source = ''): boolean {
  const text = `${message} ${source}`.trim()
  return !message.trim() || NOISE.some((r) => r.test(text))
}

export const MAX_PER_PAGE = 5

export function messageOf(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`.slice(0, 300)
  if (typeof reason === 'string') return reason.slice(0, 300)
  try {
    return JSON.stringify(reason).slice(0, 300)
  } catch {
    return 'Unreadable error'
  }
}
