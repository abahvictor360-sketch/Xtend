import 'server-only'
import { cookies, headers } from 'next/headers'
import { clientIp, lookupIp } from '@/lib/ip-geo'

/**
 * Where and on what an admin action was done, read from the request:
 * the IP (and whether it is a VPN), the device from the user agent, and
 * the location, from the browser when the admin allowed it (the
 * xt_loc cookie, set by the dashboard) or roughly from the IP.
 */
export interface AuditContext {
  ip: string | null
  user_agent: string | null
  device: Device | null
  lat?: number
  lng?: number
  accuracy_m?: number
  location_source?: 'browser' | 'ip'
  country?: string | null
  vpn?: boolean
}

export interface Device {
  type: 'phone' | 'tablet' | 'computer'
  os: string | null
  browser: string | null
  /** The Xtend app (the Capacitor shell), not a browser. */
  app: boolean
}

/** Browser, system and kind of device from a user agent. Pure: exported for checks. */
export function parseUserAgent(ua: string | null): Device | null {
  if (!ua) return null
  const v = (re: RegExp) => ua.match(re)?.[1]?.replace(/_/g, '.') ?? null
  const os = /Android/.test(ua)
    ? `Android ${v(/Android ([\d.]+)/) ?? ''}`.trim()
    : /iPhone|iPad|iPod/.test(ua)
      ? `iOS ${v(/OS ([\d_]+) like Mac/) ?? ''}`.trim()
      : /Windows NT 10/.test(ua)
        ? 'Windows 10/11'
        : /Windows NT/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? `macOS ${v(/Mac OS X ([\d_]+)/) ?? ''}`.trim()
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null
  const browser = /XtendApp/.test(ua)
    ? 'Xtend app'
    : /Edg\//.test(ua)
      ? `Edge ${v(/Edg\/(\d+)/) ?? ''}`.trim()
      : /OPR\//.test(ua)
        ? `Opera ${v(/OPR\/(\d+)/) ?? ''}`.trim()
        : /SamsungBrowser/.test(ua)
          ? `Samsung Internet ${v(/SamsungBrowser\/(\d+)/) ?? ''}`.trim()
          : /Firefox\//.test(ua)
            ? `Firefox ${v(/Firefox\/(\d+)/) ?? ''}`.trim()
            : /Chrome\//.test(ua)
              ? `Chrome ${v(/Chrome\/(\d+)/) ?? ''}`.trim()
              : /Safari\//.test(ua)
                ? `Safari ${v(/Version\/(\d+)/) ?? ''}`.trim()
                : null
  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? 'tablet'
    : /Mobile|iPhone|iPod|Android/.test(ua)
      ? 'phone'
      : 'computer'
  return { type, os, browser, app: /XtendApp/.test(ua) }
}

/** "lat,lng,accuracy,epochMs" from the dashboard, if fresh and sane. */
export function readBrowserLocation(raw: string | undefined, now = Date.now()) {
  if (!raw) return null
  const [lat, lng, acc, at] = raw.split(',').map(Number)
  if (![lat, lng, acc, at].every(Number.isFinite)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || acc < 0 || acc > 5000) return null
  // A reading from more than two hours ago no longer says where they are.
  if (now - at > 2 * 3_600_000 || at - now > 5 * 60_000) return null
  return { lat, lng, accuracy_m: acc }
}

// IP lookups are cached: an admin does many things from one address.
const ipCache = new Map<string, { at: number; geo: Awaited<ReturnType<typeof lookupIp>> }>()

/**
 * The cheap part of the context (no IP lookup unless one is cached), as a
 * base64 header for the database: rows written inside SQL functions (store
 * allocation, count requests) read it from request.headers in the
 * audit_fill_context trigger.
 */
export async function auditContextHeader(): Promise<string | null> {
  try {
    const h = await headers()
    const ua = h.get('user-agent')?.slice(0, 500) ?? null
    const ip = clientIp(h)
    const ctx: AuditContext = { ip, user_agent: ua, device: parseUserAgent(ua) }
    const geo = ip ? ipCache.get(ip)?.geo : null
    if (geo) {
      ctx.country = geo.country
      ctx.vpn = geo.proxy || geo.hosting
    }
    const browser = readBrowserLocation((await cookies()).get('xt_loc')?.value)
    if (browser) Object.assign(ctx, browser, { location_source: 'browser' as const })
    else if (geo?.lat != null && geo.lng != null) {
      Object.assign(ctx, { lat: geo.lat, lng: geo.lng, accuracy_m: 25_000, location_source: 'ip' as const })
    }
    return Buffer.from(JSON.stringify(ctx), 'utf8').toString('base64')
  } catch {
    return null
  }
}

export async function auditContext(): Promise<AuditContext | null> {
  try {
    const h = await headers()
    const ua = h.get('user-agent')?.slice(0, 500) ?? null
    const ip = clientIp(h)
    const ctx: AuditContext = { ip, user_agent: ua, device: parseUserAgent(ua) }

    let geo = ip ? ipCache.get(ip) : undefined
    if (ip && (!geo || Date.now() - geo.at > 6 * 3_600_000)) {
      geo = { at: Date.now(), geo: await lookupIp(ip, h) }
      ipCache.set(ip, geo)
      if (ipCache.size > 500) ipCache.delete(ipCache.keys().next().value!)
    }
    if (geo?.geo) {
      ctx.country = geo.geo.country
      ctx.vpn = geo.geo.proxy || geo.geo.hosting
    }

    const browser = readBrowserLocation((await cookies()).get('xt_loc')?.value)
    if (browser) {
      Object.assign(ctx, browser, { location_source: 'browser' as const })
    } else if (geo?.geo?.lat != null && geo.geo.lng != null) {
      Object.assign(ctx, { lat: geo.geo.lat, lng: geo.geo.lng, accuracy_m: 25_000, location_source: 'ip' as const })
    }
    return ctx
  } catch {
    // Outside a request (a script, a cron job): nothing to read.
    return null
  }
}
