/**
 * The address people actually use to reach the site. Behind Dokploy's proxy
 * `request.url` is the container's own (http://localhost:3000), so anything
 * built from it sends the person to a page that does not exist for them
 * (in the phone app, Chrome opens on "localhost refused to connect").
 *
 * In order: SITE_URL (or the older NEXT_PUBLIC_SITE_URL) when set; the proxy's forwarded host; and,
 * when that is still only a local name (a proxy that does not pass the real
 * host along), the address the browser itself says it is on (Origin, then
 * Referer). Moves within the site should not need this at all: see
 * sameSiteRedirect, which lets the browser keep the address it is on.
 */
export function publicOrigin(request: Request): string {
  // SITE_URL is read when the server runs; NEXT_PUBLIC_SITE_URL (the older
  // name) is fixed into the build by Next.js, so it only counts if it was
  // set when the image was built.
  const fixed = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL)?.trim()
  if (fixed) {
    try {
      return new URL(fixed).origin
    } catch {
      // fall through to the headers
    }
  }
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host
  if (isLocalHost(host)) {
    const said = browserOrigin(request)
    if (said) return said
  }
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (isLocalHost(host) ? url.protocol.replace(':', '') : 'https')
  return `${proto}://${host}`
}

/** localhost, 127.x, 0.0.0.0 or ::1, with or without a port. */
export function isLocalHost(host: string | null | undefined): boolean {
  const name = (host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '0.0.0.0' || name === '::1' || /^127\./.test(name)
}

/** The page's own address as the browser reports it, when it is a real one. */
function browserOrigin(request: Request): string | null {
  for (const value of [request.headers.get('origin'), request.headers.get('referer')]) {
    if (!value || value === 'null') continue
    try {
      const u = new URL(value)
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !isLocalHost(u.host)) return u.origin
    } catch {
      // not an address
    }
  }
  return null
}

/**
 * Moves the browser (or the phone app) to another page of the site without
 * a server redirect. Next.js turns even a relative Location into a full
 * address built from the host the proxy reports, which behind some proxies
 * is localhost: the phone then opened Chrome on "localhost refused to
 * connect". This page tells the browser to go there itself, so the address
 * it is already on is kept. Cookies set through next/headers in the same
 * route (signing out) still go out with it. Only paths within the site.
 */
export function sameSiteRedirect(path: string): Response {
  const target = path.startsWith('/') && !path.startsWith('//') ? path : '/'
  const json = JSON.stringify(target).replace(/</g, '\\u003c')
  const attr = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="refresh" content="0;url=${attr}"><title>Xtend</title></head>` +
    `<body><script>location.replace(${json})</script>` +
    `<p style="font:16px system-ui;text-align:center;margin-top:30vh"><a href="${attr}">Continue to Xtend</a></p></body></html>`
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'same-origin',
    },
  })
}
