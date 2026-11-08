import 'server-only'
import Redis from 'ioredis'

/**
 * The shared Redis, when REDIS_URL is set (deploy/DOCKER.md: one Redis
 * beside several app containers). It only ever holds what every container
 * should agree on and can lose without harm: sign-in attempt counts and
 * cached answers. Nothing here is the record of anything; that is Postgres.
 *
 * Redis must never be the reason a page fails. Commands give up quickly,
 * nothing queues while it is down, and every caller has an in-memory
 * fallback, so a missing or broken Redis just means each container counts
 * and caches on its own, as before.
 */

const COMMAND_TIMEOUT_MS = 300

/** How long the first command waits for the very first connection, once per process. */
const FIRST_CONNECT_WAIT_MS = 500

const holder = globalThis as typeof globalThis & {
  __xtendRedis?: Redis | null
  __xtendRedisWarned?: boolean
  __xtendRedisFirst?: Promise<void>
}

/** The client, or null when Redis is not configured. */
export function redis(): Redis | null {
  if (holder.__xtendRedis !== undefined) return holder.__xtendRedis
  const url = process.env.REDIS_URL
  if (!url) {
    holder.__xtendRedis = null
    return null
  }
  const client = new Redis(url, {
    lazyConnect: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: COMMAND_TIMEOUT_MS,
    // Keep trying in the background, at most every 5 s.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  })
  client.on('error', (error) => {
    if (holder.__xtendRedisWarned) return
    holder.__xtendRedisWarned = true
    console.warn(`Redis unavailable, using memory instead: ${error.message}`)
  })
  client.on('ready', () => {
    holder.__xtendRedisWarned = false
  })
  // Settles when the first connection attempt has either worked or failed,
  // so the first requests after a start are counted in Redis too, while a
  // Redis that is down never makes later requests wait.
  holder.__xtendRedisFirst = new Promise<void>((resolve) => {
    client.once('ready', () => resolve())
    client.once('error', () => resolve())
    setTimeout(resolve, FIRST_CONNECT_WAIT_MS).unref?.()
  })
  holder.__xtendRedis = client
  return client
}

/**
 * The client once its first connection attempt has settled (at most
 * FIRST_CONNECT_WAIT_MS, once per process), or null when Redis is not
 * configured. Use this for commands; it never throws.
 */
export async function redisClient(): Promise<Redis | null> {
  const client = redis()
  if (client && client.status !== 'ready') await holder.__xtendRedisFirst
  return client
}

/** Whether Redis answers right now, for the health check. Null when not configured. */
export async function redisReachable(): Promise<boolean | null> {
  const client = await redisClient()
  if (!client) return null
  try {
    // Just after start the connection may still be opening; wait a moment.
    if (client.status !== 'ready') {
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        client.once('ready', done)
        setTimeout(() => {
          client.off('ready', done)
          resolve()
        }, 1_000)
      })
    }
    return (await client.ping()) === 'PONG'
  } catch {
    return false
  }
}

/** Every key Xtend writes starts with this, so one Redis can be shared safely. */
export const REDIS_PREFIX = 'xt:'
