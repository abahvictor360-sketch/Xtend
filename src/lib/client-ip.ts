import 'server-only'

/**
 * The address a request came from, as the app's own proxy saw it.
 *
 * X-Forwarded-For is a list each proxy appends to, so anything a client
 * writes in it comes first and the entries the proxies add come last. The
 * first entry is therefore whatever the caller chose to put there. This
 * reads from the end instead, skipping the proxies Xtend sits behind:
 *
 *   TRUSTED_PROXY_HOPS=1  Nginx or Caddy on the VPS, or Vercel (default)
 *   TRUSTED_PROXY_HOPS=2  Cloudflare in front of Nginx, and so on
 *
 * Without the header (a request straight to Node), X-Real-IP, which Nginx
 * sets from the connection itself.
 */
export function requestIp(headers: Headers): string | null {
  const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS ?? 1)) || 1)
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (chain.length) return chain[Math.max(0, chain.length - hops)]
  return headers.get('x-real-ip')?.trim() || null
}
