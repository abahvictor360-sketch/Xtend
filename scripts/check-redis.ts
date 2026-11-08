/**
 * Logic checks for the shared Redis (rate limits and caches across app
 * containers, deploy/DOCKER.md):
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-redis.ts
 *
 * Starts its own throwaway redis-server on a spare port when one is
 * installed (or uses REDIS_URL if set); without one it checks only that
 * everything still works with no Redis at all. Also checks, in a child
 * process, that a Redis that does not answer never breaks or slows a caller.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

async function startRedis(): Promise<{ url: string; stop: () => void } | null> {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL, stop: () => {} }
  if (spawnSync('redis-server', ['--version']).status !== 0) return null
  const port = await freePort()
  const child: ChildProcess = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    if (spawnSync('redis-cli', ['-p', String(port), 'ping']).stdout?.toString().trim() === 'PONG') break
    await new Promise((r) => setTimeout(r, 100))
  }
  return { url: `redis://127.0.0.1:${port}`, stop: () => child.kill() }
}

/** The "Redis is down" half, run in a fresh process so its client is new. */
async function downChecks() {
  const { allowAttempt } = await import('@/lib/rate-limit')
  const { TtlCache } = await import('@/lib/ttl-cache')
  const started = Date.now()
  const answers: boolean[] = []
  for (let i = 0; i < 4; i++) answers.push(await allowAttempt('down:check', 3, 60_000))
  const cache = new TtlCache<string>(10, 'down-check')
  const loaded = await cache.remember('k', 60_000, async () => 'fresh')
  const again = await cache.remember('k', 60_000, async () => 'not used')
  const elapsed = Date.now() - started
  console.log(JSON.stringify({ answers, loaded, again, elapsed }))
  process.exit(0)
}

async function main() {
  if (process.argv[2] === '--down') return downChecks()

  const server = await startRedis()
  if (!server) {
    const { allowAttempt } = await import('@/lib/rate-limit')
    const answers: boolean[] = []
    for (let i = 0; i < 4; i++) answers.push(await allowAttempt(`norediscfg:${Date.now()}`, 3, 60_000))
    check(answers.join(',') === 'true,true,true,false', 'without Redis the limit still counts in memory')
    console.log(`\nALL ${passed} REDIS CHECKS PASSED (no redis-server here, memory only)`)
    return
  }
  process.env.REDIS_URL = server.url
  try {
    const { redis, redisReachable, REDIS_PREFIX } = await import('@/lib/redis')
    const { allowAttempt } = await import('@/lib/rate-limit')
    const { TtlCache } = await import('@/lib/ttl-cache')
    // The very first attempt after a start, before the connection is open,
    // must still be counted in Redis (not fall back to memory).
    const firstKey = `first:${Date.now()}`
    await allowAttempt(firstKey, 3, 60_000)
    const client = redis()!
    check((await client.get(`${REDIS_PREFIX}rl:${firstKey}`)) === '1', 'the first attempt after a start is counted in Redis')
    check((await redisReachable()) === true, 'the health check sees Redis')

    // Rate limits are counted in Redis, so every container sees the same count.
    const key = `check:${Date.now()}`
    const answers: boolean[] = []
    for (let i = 0; i < 5; i++) answers.push(await allowAttempt(key, 3, 60_000))
    check(answers.join(',') === 'true,true,true,false,false', 'the fourth attempt in the window is refused')
    check((await client.get(`${REDIS_PREFIX}rl:${key}`)) === '5', 'the count lives in Redis, under the xt: prefix')
    const ttl = await client.pttl(`${REDIS_PREFIX}rl:${key}`)
    check(ttl > 55_000 && ttl <= 60_000, 'the window ends when it should (not reset by later attempts)')
    await client.set(`${REDIS_PREFIX}rl:${key}:other`, '3', 'PX', 60_000)
    check(!(await allowAttempt(`${key}:other`, 3, 60_000)), 'a count made by another container is respected')
    check(await allowAttempt(`${key}:someone-else`, 3, 60_000), 'another person has their own count')

    // A shared cache: one container stores, another (empty memory) reuses it.
    const a = new TtlCache<{ n: number }>(10, 'check-shared')
    const b = new TtlCache<{ n: number }>(10, 'check-shared')
    let loads = 0
    const first = await a.remember('q', 60_000, async () => ({ n: ++loads }))
    await new Promise((r) => setTimeout(r, 50))
    const second = await b.remember('q', 60_000, async () => ({ n: ++loads }))
    check(first.n === 1 && second.n === 1 && loads === 1, 'a second container reuses the first one’s answer')
    const left = await client.pttl(`${REDIS_PREFIX}cache:check-shared:q`)
    check(left > 55_000 && left <= 60_000, 'the shared entry expires with its time to live')

    // A plain cache never touches Redis.
    const local = new TtlCache<string>(10)
    await local.remember('q', 60_000, async () => 'mine')
    check((await client.keys(`${REDIS_PREFIX}cache:undefined:*`)).length === 0, 'a cache not marked shared stays in memory')

    // Nothing kept for 0 ms, and a failure is not kept anywhere.
    const c = new TtlCache<string>(10, 'check-zero')
    await c.remember('z', () => 0, async () => 'skip')
    await new Promise((r) => setTimeout(r, 50))
    check((await client.exists(`${REDIS_PREFIX}cache:check-zero:z`)) === 0, 'an answer worth 0 ms is not shared')
    let threw = false
    try {
      await c.remember('f', 60_000, async () => {
        throw new Error('boom')
      })
    } catch {
      threw = true
    }
    await new Promise((r) => setTimeout(r, 50))
    check(threw && (await client.exists(`${REDIS_PREFIX}cache:check-zero:f`)) === 0, 'a failed load is not shared')

    // Deleting clears it for every container.
    a.delete('q')
    await new Promise((r) => setTimeout(r, 50))
    check((await client.exists(`${REDIS_PREFIX}cache:check-shared:q`)) === 0, 'delete clears the shared entry')

    // A Redis that does not answer: everything still works, and quickly.
    const deadPort = await freePort()
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, __filename, '--down'],
      { env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${deadPort}` }, encoding: 'utf8', timeout: 20_000 },
    )
    const line = (child.stdout ?? '').trim().split('\n').pop() ?? '{}'
    const down = JSON.parse(line) as { answers: boolean[]; loaded: string; again: string; elapsed: number }
    check(down.answers.join(',') === 'true,true,true,false', 'with Redis down the limit falls back to memory')
    check(down.loaded === 'fresh' && down.again === 'fresh', 'with Redis down the cache falls back to memory')
    check(down.elapsed < 3_000, `with Redis down nothing waits long (${down.elapsed} ms)`)

    await client.quit()
  } finally {
    server.stop()
  }
  console.log(`\nALL ${passed} REDIS CHECKS PASSED`)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
