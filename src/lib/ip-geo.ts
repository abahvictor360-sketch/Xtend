import 'server-only'

/**
 * IP geolocation for the VPN / location-manipulation checks.
 *
 * Free and keyless by default: ip-api.com returns a lat/lng, a country, and
 * crucially a proxy / hosting flag that marks VPN and datacentre IPs, with no
 * sign-up (45 requests a minute, which is far above Xtend's clock-in rate).
 * Swap the provider by pointing IP_GEO_URL at another JSON endpoint that uses
 * the same field names, or set IP_GEO_DISABLED=1 to turn the lookup off.
 *
 * When the lookup cannot run (no network, a private IP, the rate limit), the
 * caller simply gets null and the IP-based checks are skipped for that event.
 * A clock-in is never blocked by this.
 */

export interface IpGeo {
  ip: string
  lat: number | null
  lng: number | null
  country: string | null
  /** True when the IP is a known VPN, Tor, or public proxy. */
  proxy: boolean
  /** True when the IP belongs to a hosting / datacentre range (also VPN-like). */
  hosting: boolean
  /** True for a mobile carrier IP, which legitimately sits far from the user. */
  mobile: boolean
  source: string
}

const PRIVATE = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
]

/** The first public IP in an x-forwarded-for chain, or null. */
export function clientIp(headers: Headers): string | null {
  const candidates = [
    ...(headers.get('x-forwarded-for')?.split(',') ?? []),
    headers.get('x-real-ip') ?? '',
    headers.get('cf-connecting-ip') ?? '',
  ]
    .map((s) => s.trim())
    .filter(Boolean)

  for (const ip of candidates) {
    if (!PRIVATE.some((re) => re.test(ip))) return ip
  }
  return null
}

function isPrivate(ip: string) {
  return PRIVATE.some((re) => re.test(ip))
}

/**
 * Vercel injects these on every request when the app is deployed there, so a
 * country and a coarse lat/lng are available with no external call. They
 * carry no VPN flag, which is why they are only the fallback.
 */
function fromVercelHeaders(ip: string, headers: Headers): IpGeo | null {
  const country = headers.get('x-vercel-ip-country')
  const lat = headers.get('x-vercel-ip-latitude')
  const lng = headers.get('x-vercel-ip-longitude')
  if (!country && !lat) return null
  return {
    ip,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    country: country ?? null,
    proxy: false,
    hosting: false,
    mobile: false,
    source: 'vercel-headers',
  }
}

async function fromIpApi(ip: string, signal: AbortSignal): Promise<IpGeo | null> {
  // fields: status, country code, lat, lon, proxy, hosting, mobile.
  const base = process.env.IP_GEO_URL ?? 'http://ip-api.com/json'
  const url = `${base}/${encodeURIComponent(ip)}?fields=status,message,countryCode,lat,lon,proxy,hosting,mobile`
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) return null
  const j = (await res.json()) as Record<string, unknown>
  if (j.status !== 'success') return null
  return {
    ip,
    lat: typeof j.lat === 'number' ? j.lat : null,
    lng: typeof j.lon === 'number' ? j.lon : null,
    country: typeof j.countryCode === 'string' ? j.countryCode : null,
    proxy: j.proxy === true,
    hosting: j.hosting === true,
    mobile: j.mobile === true,
    source: 'ip-api',
  }
}

export async function lookupIp(ip: string | null, headers: Headers): Promise<IpGeo | null> {
  if (process.env.IP_GEO_DISABLED === '1') return null
  if (!ip || isPrivate(ip)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const hit = await fromIpApi(ip, controller.signal)
    if (hit) return hit
  } catch {
    // Network error, timeout, or rate limit: fall through to headers.
  } finally {
    clearTimeout(timer)
  }
  return fromVercelHeaders(ip, headers)
}
