/**
 * The pure parts of Xtend's error logging (src/lib/log.ts), so
 * scripts/check-error-handling.ts can test them: what an error says, what
 * may be written down, and how often the same problem is recorded.
 */

export type ErrorSource = 'server' | 'client' | 'job'

export interface Described {
  name: string
  message: string
  /** The first lines of the stack, for the server log only. */
  stack?: string
}

/** Anything thrown, as a name and a message (never throws itself). */
export function describe(error: unknown): Described {
  try {
    if (error instanceof Error) {
      return {
        name: error.name || 'Error',
        message: String(error.message || error.name || 'Error').slice(0, 500),
        stack: error.stack?.split('\n').slice(0, 6).join('\n'),
      }
    }
    if (error && typeof error === 'object') {
      const o = error as { message?: unknown; code?: unknown; details?: unknown }
      const message = typeof o.message === 'string' ? o.message : JSON.stringify(error)
      return { name: typeof o.code === 'string' ? `Error ${o.code}` : 'Error', message: message.slice(0, 500) }
    }
    return { name: 'Error', message: String(error ?? 'Unknown error').slice(0, 500) }
  } catch {
    return { name: 'Error', message: 'Unreadable error' }
  }
}

/** Keys whose values are never written down. */
const SECRET = /pass(word)?|secret|token|key|authorization|cookie|otp|code_verifier|session/i

/** The context, safe to log: secrets out, long text cut, at most 20 keys, two levels. */
export function redact(context: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context ?? {}).slice(0, 20)) {
    if (SECRET.test(k)) out[k] = '[hidden]'
    else if (typeof v === 'string') out[k] = v.length > 300 ? `${v.slice(0, 300)}…` : v
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = depth < 1 ? redact(v as Record<string, unknown>, depth + 1) : '[object]'
    else if (Array.isArray(v)) out[k] = v.slice(0, 10)
    else out[k] = v
  }
  return out
}

/** The same problem: where it came from, what, and the start of its message. */
export function fingerprintOf(source: ErrorSource, event: string, message: string, path?: string | null) {
  return `${source}|${event}|${message.slice(0, 160)}|${path ?? ''}`
}

/** Recorded at most once a minute per problem from one server; the log line always. */
export const RECORD_EVERY_MS = 60_000

export function dueToRecord(seen: Map<string, number>, fingerprint: string, now = Date.now()): boolean {
  const last = seen.get(fingerprint)
  if (last !== undefined && now - last < RECORD_EVERY_MS) return false
  if (seen.size > 500) seen.clear()
  seen.set(fingerprint, now)
  return true
}
