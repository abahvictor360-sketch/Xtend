import 'server-only'
import { redis, redisClient, REDIS_PREFIX } from '@/lib/redis'

/**
 * A small in-memory cache for work that is the same for many people: the
 * answer to a question already asked, the global rows every phone reads, a
 * lookup for a past day. It keeps load off the database and the paid APIs.
 *
 * It only ever saves work and never decides who may see what: callers put
 * whatever decides access (the asker, their role) into the key. It holds at
 * most `max` entries (oldest-used dropped first), forgets an entry after its
 * time is up, and never keeps a failure.
 *
 * A cache made with `shared` also keeps its entries in Redis when
 * REDIS_URL is set, so every app container reuses one answer: memory first,
 * then Redis, then the real work. Only `fetch`, `store` and `remember` use
 * Redis; `get` and `set` stay in memory. Shared values must survive JSON.
 * Without Redis, or while it is down, a shared cache is a memory cache.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>()
  private readonly inflight = new Map<string, Promise<V>>()

  /** `shared`: the Redis key prefix for this cache, or none to stay in memory. */
  constructor(
    private readonly max = 500,
    private readonly shared?: string,
  ) {}

  private redisKey(key: string) {
    return `${REDIS_PREFIX}cache:${this.shared}:${key}`
  }

  /** Memory, then (for a shared cache) Redis. Never throws. */
  async fetch(key: string): Promise<V | undefined> {
    const hit = this.get(key)
    if (hit !== undefined || !this.shared) return hit
    const client = await redisClient()
    if (!client) return undefined
    try {
      const [[, raw], [, left]] = (await client.multi().get(this.redisKey(key)).pttl(this.redisKey(key)).exec()) as [
        [unknown, string | null],
        [unknown, number],
      ]
      if (raw == null || !(left > 0)) return undefined
      const value = JSON.parse(raw) as V
      this.set(key, value, left)
      return value
    } catch {
      return undefined
    }
  }

  /** Into memory and (for a shared cache) Redis, without waiting for Redis. */
  store(key: string, value: V, ttlMs: number) {
    this.set(key, value, ttlMs)
    if (!this.shared || ttlMs <= 0) return
    const client = redis()
    if (!client) return
    try {
      void client.set(this.redisKey(key), JSON.stringify(value), 'PX', Math.ceil(ttlMs)).catch(() => {})
    } catch {
      // Not JSON-able, or Redis refused at once: memory still has it.
    }
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (hit.expires <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Most recently used goes last, so the first key is the one to drop.
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit.value
  }

  set(key: string, value: V, ttlMs: number) {
    if (ttlMs <= 0) return
    this.entries.delete(key)
    this.entries.set(key, { value, expires: Date.now() + ttlMs })
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  delete(key: string) {
    this.entries.delete(key)
    if (this.shared) void redis()?.del(this.redisKey(key)).catch(() => {})
  }

  clear() {
    this.entries.clear()
    this.inflight.clear()
  }

  /**
   * The cached value, or `load()` run once for everyone asking at the same
   * moment. A failed load is not kept, and the next caller tries again.
   * `ttlMs` may be a function of the value (some answers are not worth
   * keeping); returning 0 keeps nothing.
   */
  async remember(key: string, ttlMs: number | ((value: V) => number), load: () => Promise<V>): Promise<V> {
    const hit = await this.fetch(key)
    if (hit !== undefined) return hit
    const running = this.inflight.get(key)
    if (running) return running
    const promise = (async () => {
      try {
        const value = await load()
        this.store(key, value, typeof ttlMs === 'function' ? ttlMs(value) : ttlMs)
        return value
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, promise)
    return promise
  }
}

// One cache per name for the whole server process, even when the bundler
// gives two routes their own copy of this file.
const registry = globalThis as typeof globalThis & { __xtendCaches?: Map<string, TtlCache<unknown>> }

export function namedCache<V>(name: string, max = 500, options: { shared?: boolean } = {}): TtlCache<V> {
  registry.__xtendCaches ??= new Map()
  let cache = registry.__xtendCaches.get(name) as TtlCache<V> | undefined
  if (!cache) {
    cache = new TtlCache<V>(max, options.shared ? name : undefined)
    registry.__xtendCaches.set(name, cache as TtlCache<unknown>)
  }
  return cache
}
