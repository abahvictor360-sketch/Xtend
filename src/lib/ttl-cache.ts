import 'server-only'

/**
 * A small in-memory cache for work that is the same for many people: the
 * answer to a question already asked, the global rows every phone reads, a
 * lookup for a past day. It keeps load off the database and the paid APIs.
 *
 * Nothing here is shared between servers or survives a restart, so it only
 * ever saves work and never decides who may see what: callers put whatever
 * decides access (the asker, their role) into the key. It holds at most
 * `max` entries (oldest-used dropped first), forgets an entry after its
 * time is up, and never keeps a failure.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>()
  private readonly inflight = new Map<string, Promise<V>>()

  constructor(private readonly max = 500) {}

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
    const hit = this.get(key)
    if (hit !== undefined) return hit
    const running = this.inflight.get(key)
    if (running) return running
    const promise = (async () => {
      try {
        const value = await load()
        this.set(key, value, typeof ttlMs === 'function' ? ttlMs(value) : ttlMs)
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

export function namedCache<V>(name: string, max = 500): TtlCache<V> {
  registry.__xtendCaches ??= new Map()
  let cache = registry.__xtendCaches.get(name) as TtlCache<V> | undefined
  if (!cache) {
    cache = new TtlCache<V>(max)
    registry.__xtendCaches.set(name, cache as TtlCache<unknown>)
  }
  return cache
}
