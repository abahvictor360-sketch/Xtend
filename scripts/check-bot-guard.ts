import assert from 'node:assert/strict'
import { botDecision, isBotUserAgent, isOpenPath } from '@/lib/bot-guard'
import {
  TURNSTILE_VERIFY_URL,
  parseSiteverify,
  turnstileEnabled,
  turnstileSiteKey,
  verifyTurnstile,
} from '@/lib/turnstile'

// Bots, crawlers, scripts and automation: refused on pages and APIs.
const BLOCKED = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
  'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
  'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)',
  'Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
  'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'CCBot/2.0 (https://commoncrawl.org/faq/)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'anthropic-ai',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  'WhatsApp/2.23.20.0 A',
  'python-requests/2.31.0',
  'Python-urllib/3.11',
  'Python/3.11 aiohttp/3.9.1',
  'Scrapy/2.11.0 (+https://scrapy.org)',
  'curl/8.5.0',
  'Wget/1.21.4',
  'Go-http-client/1.1',
  'Java/17.0.2',
  'okhttp/4.12.0',
  'libwww-perl/6.72',
  'Apache-HttpClient/4.5.14 (Java/17.0.8)',
  'axios/1.6.2',
  'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
  'node',
  'undici',
  'PostmanRuntime/7.36.0',
  'insomnia/8.4.5',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.28 Safari/537.36',
  'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1',
  'Mozilla/5.0 Puppeteer',
  'Playwright/1.40',
  'Selenium/4.15 (python linux)',
  'SomeNewBot/1.0',
  'my-crawler',
  'MySpider 2.0',
  'acme-scraper/0.1',
  'Mozilla/5.0',
]
for (const ua of BLOCKED) {
  assert.equal(isBotUserAgent(ua), true, `should be a bot: ${ua}`)
  for (const path of ['/', '/login', '/admin', '/download', '/api/auth/sign-in', '/api/messages']) {
    assert.equal(botDecision(path, ua).block, true, `${path} should refuse ${ua}`)
  }
}

// Empty or missing user agent: refused (except open paths, below).
for (const ua of [null, undefined, '', '   ']) {
  assert.deepEqual(botDecision('/login', ua), { block: true, reason: 'empty' })
  assert.deepEqual(botDecision('/api/auth/sign-in', ua), { block: true, reason: 'empty' })
}

// Real browsers, the Xtend apps and their WebViews: always allowed.
const ALLOWED: [string, string][] = [
  ['browser', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'],
  ['browser', 'Mozilla/5.0 (Linux; Android 13; TECNO KI7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36'],
  ['browser', 'Mozilla/5.0 (Linux; Android 12; Infinix X6816) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'],
  ['browser', 'Mozilla/5.0 (Linux; Android 11; Cubot X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36'],
  ['browser', 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'],
  ['browser', 'Mozilla/5.0 (Linux; Android 14; itel A665L) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPR/84.0.2254.73423'],
  ['browser', 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0'],
  ['browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'],
  ['browser', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1'],
  ['browser', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'],
  ['browser', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'],
  ['browser', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'],
  ['browser', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'],
  ['browser', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'],
  // The Capacitor apps: an Android WebView ("wv") and an iPhone WKWebView, plus "XtendApp".
  ['app', 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 XtendApp'],
  ['app', 'Mozilla/5.0 (Linux; Android 11; Cubot X30 Build/RP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 XtendApp'],
  ['app', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 XtendApp'],
  // Even if an app build's WebView ever reported itself oddly, the mark wins.
  ['app', 'okhttp/4.12.0 XtendApp'],
  // Vercel's own requests.
  ['vercel', 'vercel-cron/1.0'],
  ['vercel', 'vercel-screenshot/1.0'],
]
for (const [reason, ua] of ALLOWED) {
  for (const path of ['/', '/login', '/admin/attendance', '/field', '/download', '/api/auth/sign-in', '/api/beacon']) {
    assert.deepEqual(botDecision(path, ua), { block: false, reason }, `${path} should allow ${ua}`)
  }
}

// Open paths: allowed for anyone, whatever the user agent (or none).
const OPEN = [
  '/api/cron/alerts', '/api/cron/absence-sweep', '/api/cron/purge-selfies', '/api/cron/metrics',
  '/api/track/device', '/api/track/token', '/api/track/stop',
  '/api/health', '/api/version',
  '/_next/static/chunks/main.js', '/_next/image', '/icons/icon-192.png', '/brand/xpel.svg',
  '/sw.js', '/manifest.webmanifest', '/favicon.ico', '/robots.txt', '/guide/clock-in.png',
]
const NATIVE_AND_JOBS = [
  null, '', 'curl/8.5.0', 'node', 'Wget/1.21', 'python-requests/2.31',
  // Android's HttpURLConnection (old app builds' background tracker) and iOS URLSession.
  'Dalvik/2.1.0 (Linux; U; Android 13; SM-A135F Build/TP1A.220624.014)',
  'Xtend/42 CFNetwork/1494.0.7 Darwin/23.4.0',
  'okhttp/4.12.0', 'GitHub-Hookshot', 'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
]
for (const path of OPEN) {
  assert.equal(isOpenPath(path), true, path)
  for (const ua of NATIVE_AND_JOBS) assert.deepEqual(botDecision(path, ua), { block: false, reason: 'open-path' }, `${path} ${ua}`)
}
// Prefixes match whole segments only.
for (const path of ['/api/cronjob', '/api/trackers', '/api/healthy', '/api/versions', '/login', '/', '/admin']) {
  assert.equal(isOpenPath(path), false, path)
  assert.equal(botDecision(path, 'curl/8.5.0').block, true, path)
}
// The native tracker's default agents are not refused even outside /api/track.
assert.equal(isBotUserAgent('Dalvik/2.1.0 (Linux; U; Android 13; SM-A135F Build/TP1A)'), false)
assert.equal(isBotUserAgent('Xtend/42 CFNetwork/1494.0.7 Darwin/23.4.0'), false)

// Turnstile: on only with both keys.
assert.equal(turnstileEnabled({}), false)
assert.equal(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAA' }), false)
assert.equal(turnstileEnabled({ TURNSTILE_SECRET_KEY: '0x4BBB' }), false)
assert.equal(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' ', TURNSTILE_SECRET_KEY: '0x4BBB' }), false)
assert.equal(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAA', TURNSTILE_SECRET_KEY: '0x4BBB' }), true)
assert.equal(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAA' }), undefined)
assert.equal(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' 0x4AAA ', TURNSTILE_SECRET_KEY: 'x' }), '0x4AAA')

// Cloudflare's answer.
assert.deepEqual(parseSiteverify({ success: true, hostname: 'xtend.example' }), { ok: true })
assert.deepEqual(parseSiteverify({ success: false, 'error-codes': ['invalid-input-response'] }), { ok: false, reason: 'invalid-input-response' })
assert.deepEqual(parseSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate', 'x'] }), { ok: false, reason: 'timeout-or-duplicate,x' })
assert.deepEqual(parseSiteverify({ success: 'true' }), { ok: false, reason: 'not-confirmed' })
assert.deepEqual(parseSiteverify(null), { ok: false, reason: 'not-confirmed' })
assert.deepEqual(parseSiteverify('ok'), { ok: false, reason: 'not-confirmed' })

async function main() {
  const calls: { url: string; body: URLSearchParams }[] = []
  const stub = (answer: unknown, status = 200) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as URLSearchParams })
      return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

  assert.deepEqual(await verifyTurnstile('tok', '1.2.3.4', { secret: 's3', fetchImpl: stub({ success: true }) }), { ok: true })
  assert.equal(calls[0].url, TURNSTILE_VERIFY_URL)
  assert.equal(calls[0].body.get('secret'), 's3')
  assert.equal(calls[0].body.get('response'), 'tok')
  assert.equal(calls[0].body.get('remoteip'), '1.2.3.4')

  await verifyTurnstile('tok', 'unknown', { secret: 's3', fetchImpl: stub({ success: true }) })
  assert.equal(calls[1].body.has('remoteip'), false)

  assert.deepEqual(
    await verifyTurnstile('bad', null, { secret: 's3', fetchImpl: stub({ success: false, 'error-codes': ['invalid-input-response'] }) }),
    { ok: false, reason: 'invalid-input-response' },
  )
  assert.deepEqual(await verifyTurnstile('tok', null, { secret: 's3', fetchImpl: stub({}, 500) }), { ok: false, reason: 'http-500' })
  const before = calls.length
  for (const token of [undefined, null, '', 'x'.repeat(3000)]) {
    assert.deepEqual(await verifyTurnstile(token, null, { secret: 's3', fetchImpl: stub({ success: true }) }), { ok: false, reason: 'missing-token' })
  }
  assert.equal(calls.length, before, 'no token: Cloudflare is not even asked')
  const down = (async () => {
    throw new Error('offline')
  }) as typeof fetch
  assert.deepEqual(await verifyTurnstile('tok', null, { secret: 's3', fetchImpl: down }), { ok: false, reason: 'unreachable' })
  const notJson = (async () => new Response('<html>', { status: 200 })) as typeof fetch
  assert.deepEqual(await verifyTurnstile('tok', null, { secret: 's3', fetchImpl: notJson }), { ok: false, reason: 'not-confirmed' })
  const saved = process.env.TURNSTILE_SECRET_KEY
  delete process.env.TURNSTILE_SECRET_KEY
  assert.deepEqual(await verifyTurnstile('tok', null, { fetchImpl: stub({ success: true }) }), { ok: false, reason: 'no-secret' })
  if (saved !== undefined) process.env.TURNSTILE_SECRET_KEY = saved

  console.log('ALL BOT GUARD CHECKS PASSED')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
