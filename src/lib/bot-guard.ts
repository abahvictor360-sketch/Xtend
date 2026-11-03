import { APP_AGENT_MARK } from '@/lib/app-agent'

/**
 * Xtend is a private staff app: nothing in it is for search engines, AI
 * crawlers, scrapers or scripts. The middleware asks `botDecision` about
 * every request it sees and answers 403 when the user agent is empty or
 * looks like one of those.
 *
 * A user agent is easy to fake, so this only turns away the honest and
 * the lazy; the password check, the sign-in lockout (0077), the optional
 * human check (Turnstile) and the platform's firewall do the rest.
 *
 * Never blocked, whatever they send:
 * - the scheduled jobs (`/api/cron/*`, which need CRON_SECRET; called by
 *   curl, `node run-job.mjs` and Vercel's cron);
 * - the phone's background tracker (`/api/track/*`, which needs its own
 *   token; old app builds send Java's or iOS's default user agent);
 * - health and version checks (`/api/health`, `/api/version`: Docker's
 *   HEALTHCHECK, deploy.sh, uptime monitors);
 * - static files and `robots.txt` (a crawler must be able to read it).
 */

/** Paths answered to anyone. Prefix match on a whole path segment. */
export const OPEN_PATH_PREFIXES = [
  '/api/cron',
  '/api/track',
  '/api/health',
  '/api/version',
  '/_next/static',
  '/_next/image',
  '/icons',
  '/brand',
] as const

/** Single files answered to anyone. */
export const OPEN_FILES = [
  '/robots.txt',
  '/sw.js',
  '/manifest.webmanifest',
  '/favicon.ico',
] as const

/** A file with one of these extensions is a static asset: left open. */
const STATIC_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|woff2?|ttf|txt|webmanifest)$/i

/**
 * Search engines, SEO tools, AI crawlers, link previewers, scripting
 * libraries and browser automation. Matched case-insensitively anywhere in
 * the user agent.
 */
export const BOT_AGENT_PATTERNS = [
  // Search engines
  'googlebot', 'google-inspectiontool', 'googleother', 'google-extended', 'mediapartners-google',
  'adsbot', 'storebot', 'bingbot', 'bingpreview', 'msnbot', 'slurp', 'yandex', 'baidu', 'baiduspider',
  'duckduckbot', 'duckassistbot', 'sogou', 'exabot', 'seznambot', 'yeti', 'qwantify',
  'applebot', 'petalbot', 'mojeek',
  // SEO and marketing crawlers
  'ahrefs', 'semrush', 'mj12', 'dotbot', 'rogerbot', 'screaming frog', 'serpstat', 'dataforseo',
  'blexbot', 'megaindex', 'seokicks', 'linkdex', 'barkrowler',
  // AI crawlers and assistants
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'ccbot', 'claudebot', 'claude-web', 'claude-user',
  'claude-searchbot', 'anthropic-ai', 'perplexitybot', 'perplexity-user', 'bytespider', 'amazonbot',
  'cohere-ai', 'diffbot', 'youbot', 'meta-externalagent', 'meta-externalfetcher', 'imagesiftbot',
  'omgili', 'timpibot', 'ai2bot', 'friendlycrawler', 'img2dataset',
  // Link previews (a shared link stays a plain link)
  'facebookexternalhit', 'facebot', 'whatsapp', 'telegrambot', 'twitterbot', 'slackbot',
  'discordbot', 'linkedinbot', 'skypeuripreview', 'embedly', 'pinterestbot',
  // Scripting libraries and command-line tools
  'python-requests', 'python-urllib', 'python-httpx', 'aiohttp', 'httpx', 'scrapy', 'curl', 'wget',
  'go-http-client', 'java/', 'java-http-client', 'okhttp', 'libwww', 'lwp-', 'httpclient',
  'axios', 'node-fetch', 'undici', 'postman', 'insomnia', 'httpie', 'guzzle', 'ruby',
  'php/', 'perl', 'restsharp', 'powershell', 'winhttp', 'mechanize', 'httrack', 'nutch', 'heritrix',
  // Browser automation
  'headlesschrome', 'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'webdriver',
  'electron', 'slimerjs', 'cypress',
  // Anything that calls itself one
  'crawler', 'crawl', 'spider', 'scraper', 'scrape',
] as const

/** User agents that are exactly a bare runtime name, as Node's fetch sends. */
const BARE_RUNTIME = /^(?:node|deno|bun|python|java|go|ruby|php|dart|mozilla(?:\/[\d.]+)?)$/i

/**
 * "bot" as its own word or at the end of a name (Googlebot, AdsBot-Google,
 * "some bot"), but not inside a phone's model name. Cubot is a phone brand
 * sold in Nigeria ("Cubot X30"), so it is taken out before this runs.
 */
const BOT_WORD = /bot(?![a-z])/i
const PHONE_MODELS_WITH_BOT = /cubot/gi

/** Vercel's own requests (cron, deployment screenshots, favicon fetch). */
const VERCEL_INTERNAL = /^vercel-/i

const PATTERN = new RegExp(
  BOT_AGENT_PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
)

export type BotDecision =
  | { block: false; reason: 'open-path' | 'app' | 'vercel' | 'browser' }
  | { block: true; reason: 'empty' | 'bot' }

/** True for paths every caller may reach, bot or not. */
export function isOpenPath(path: string): boolean {
  if ((OPEN_FILES as readonly string[]).includes(path)) return true
  if (OPEN_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true
  return STATIC_FILE.test(path)
}

/** True when the user agent belongs to a crawler, script or automation. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim()
  if (!ua) return true
  if (ua.includes(APP_AGENT_MARK)) return false
  if (VERCEL_INTERNAL.test(ua)) return false
  if (BARE_RUNTIME.test(ua)) return true
  if (PATTERN.test(ua)) return true
  return BOT_WORD.test(ua.replace(PHONE_MODELS_WITH_BOT, ''))
}

/** Should this request be refused? Pure, so it can be tested. */
export function botDecision(path: string, userAgent: string | null | undefined): BotDecision {
  if (isOpenPath(path)) return { block: false, reason: 'open-path' }
  const ua = (userAgent ?? '').trim()
  if (!ua) return { block: true, reason: 'empty' }
  // The Xtend apps first: their WebView agent is an ordinary browser's
  // plus "XtendApp", and nothing about them should ever be refused.
  if (ua.includes(APP_AGENT_MARK)) return { block: false, reason: 'app' }
  if (VERCEL_INTERNAL.test(ua)) return { block: false, reason: 'vercel' }
  return isBotUserAgent(ua) ? { block: true, reason: 'bot' } : { block: false, reason: 'browser' }
}

/** The answer a refused request gets: short, plain, not indexable. */
export const BOT_BLOCKED_BODY = 'Xtend is a private staff app. Automated access is not allowed.'
