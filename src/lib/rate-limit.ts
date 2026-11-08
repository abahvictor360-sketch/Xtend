import 'server-only'
import { requestIp } from '@/lib/client-ip'
import { redisClient, REDIS_PREFIX } from '@/lib/redis'

/**
 * A fixed-window counter. With REDIS_URL set it is kept in Redis, so every
 * app container counts the same attempts (deploy/DOCKER.md); otherwise, or
 * while Redis is unreachable, in this server process, which still slows a
 * guesser down. Never throws: a broken Redis falls back to memory.
 */
const windows = new Map<string, { count: number; resetAt: number }>()

// One round trip: count, and start the window on the first attempt.
const COUNT_SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`

/** Counts an attempt. False once `limit` attempts were made in the window. */
export async function allowAttempt(key: string, limit: number, windowMs: number): Promise<boolean> {
  const client = await redisClient()
  if (client) {
    try {
      const count = Number(await client.eval(COUNT_SCRIPT, 1, `${REDIS_PREFIX}rl:${key}`, String(windowMs)))
      if (Number.isFinite(count)) return count <= limit
    } catch {
      // Unreachable or slow: count here instead.
    }
  }
  return allowAttemptInMemory(key, limit, windowMs)
}

/** The in-process counter, used without Redis (and by the checks). */
export function allowAttemptInMemory(key: string, limit: number, windowMs: number): boolean {
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
