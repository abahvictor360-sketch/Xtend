import 'server-only'
import { requestIp } from '@/lib/client-ip'

/**
 * A fixed-window counter kept in this server process. Xtend runs as one
 * Node process on a VPS, so one process sees every attempt. Behind several
 * processes each keeps its own count, which still slows a guesser down.
 */
const windows = new Map<string, { count: number; resetAt: number }>()

/** Counts an attempt. False once `limit` attempts were made in the window. */
export function allowAttempt(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = windows.get(key)
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    if (windows.size > 10_000) sweep(now)
    return true
  }
  entry.count += 1
  return entry.count <= limit
}

function sweep(now: number) {
  for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key)
}

/** The caller's address, as the app's own proxy saw it (lib/client-ip.ts). */
export function clientAddress(request: Request): string {
  return requestIp(request.headers) ?? 'unknown'
}
