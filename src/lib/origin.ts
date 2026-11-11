/**
 * The address people actually use to reach the site. Behind Dokploy's proxy
 * `request.url` is the container's own (http://localhost:3000), so a redirect
 * built from it sends the person to a page that does not exist for them.
 * The proxy's forwarded headers carry the real host; NEXT_PUBLIC_SITE_URL
 * (when set) wins.
 */
export function publicOrigin(request: Request): string {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (fixed) {
    try {
      return new URL(fixed).origin
    } catch {
      // fall through to the headers
    }
  }
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? url.protocol.replace(':', '') : 'https')
  return `${proto}://${host}`
}
