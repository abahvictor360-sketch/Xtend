import 'server-only'
import { lookupIp, type IpGeo } from '@/lib/ip-geo'

/**
 * The manipulation checks that need more than the GPS columns: the request
 * IP, the phone's time zone, and the GPS fix's extra fields. Pure and
 * side-effect free. The caller records whatever comes back through the
 * flag_own_integrity() RPC.
 *
 * Every check is deliberately forgiving. A Nigerian marketer on a mobile
 * network can carry a carrier IP that geolocates a city or two away, so the
 * distance threshold is generous and a mobile IP softens it further. The aim
 * is to catch someone sitting at home behind a VPN with a fake GPS pin, not
 * to punish a weak signal.
 */

/** Kinds this module can raise, matching migration 030. */
export type SignalKind =
  | 'vpn_suspected'
  | 'ip_location_mismatch'
  | 'timezone_mismatch'
  | 'gps_mock_fingerprint'
  | 'mock_location_confirmed'
  | 'device_integrity_failed'

export interface Signal {
  kind: SignalKind
  severity: 'low' | 'medium' | 'high'
  summary: string
  detail: Record<string, unknown>
}

export interface EvaluateInput {
  lat: number
  lng: number
  accuracy_m: number
  device_info: Record<string, unknown>
  headers: Headers
}

export interface EvaluateResult {
  signals: Signal[]
  ip: IpGeo | null
}

/** Great-circle distance in km. */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// A carrier or ISP IP can legitimately sit this far from the handset; beyond
// it, GPS and network disagree too much to be the same place.
const IP_MISMATCH_KM = 400
const IP_MISMATCH_KM_MOBILE = 800

export async function evaluateLocationIntegrity(
  input: EvaluateInput,
  ipFromHeaders: string | null,
): Promise<EvaluateResult> {
  const signals: Signal[] = []

  // --- Native shell (migration 032). When Xtend runs inside the Android/iOS
  //     wrapper, the OS reports the hard mock-location flag and whether the
  //     device is rooted / jailbroken. These are the strongest signals we
  //     have, because they come from the platform, not a heuristic. ---
  const native = (input.device_info.native ?? null) as Record<string, unknown> | null
  if (native) {
    if (native.is_mock === true) {
      signals.push({
        kind: 'mock_location_confirmed',
        severity: 'high',
        summary: 'The phone reported the location came from a fake-GPS (mock) provider',
        detail: { platform: native.platform ?? null },
      })
    }
    if (native.compromised === true) {
      signals.push({
        kind: 'device_integrity_failed',
        severity: 'high',
        summary:
          native.platform === 'ios'
            ? 'Clocked in from a jailbroken phone, where location can be faked'
            : 'Clocked in from a rooted phone, where location can be faked',
        detail: { platform: native.platform ?? null },
      })
    }
  }

  const ip = await lookupIp(ipFromHeaders, input.headers)

  // --- IP based: VPN / proxy / hosting, and IP-vs-GPS distance. ---
  if (ip) {
    if (ip.proxy || ip.hosting) {
      signals.push({
        kind: 'vpn_suspected',
        severity: 'high',
        summary: ip.proxy
          ? 'Clocked in through a VPN or proxy IP address'
          : 'Clocked in through a hosting / datacentre IP address',
        detail: { ip: ip.ip, country: ip.country, proxy: ip.proxy, hosting: ip.hosting, source: ip.source },
      })
    }

    if (ip.lat != null && ip.lng != null) {
      const km = distanceKm(input.lat, input.lng, ip.lat, ip.lng)
      const limit = ip.mobile ? IP_MISMATCH_KM_MOBILE : IP_MISMATCH_KM
      if (km > limit) {
        signals.push({
          kind: 'ip_location_mismatch',
          severity: 'high',
          summary: `GPS and internet address are ${Math.round(km)} km apart`,
          detail: {
            km: Math.round(km),
            ip_country: ip.country,
            mobile: ip.mobile,
            ip: ip.ip,
            source: ip.source,
          },
        })
      }
    }
  }

  // --- Phone time zone. A phone in Nigeria is on Africa/Lagos, UTC+1. A
  //     device set to another zone is either travelling or faking location. ---
  const tz = typeof input.device_info.tz === 'string' ? (input.device_info.tz as string) : null
  const offset =
    typeof input.device_info.tz_offset_min === 'number'
      ? (input.device_info.tz_offset_min as number)
      : null
  // getTimezoneOffset() returns -60 for UTC+1.
  if ((tz && tz !== 'Africa/Lagos' && !tz.startsWith('Africa/')) || (offset != null && offset !== -60)) {
    signals.push({
      kind: 'timezone_mismatch',
      severity: 'medium',
      summary: `Phone time zone is ${tz ?? 'set'} (${offset != null ? `UTC${offset <= 0 ? '+' : '-'}${Math.abs(offset) / 60}` : 'unknown offset'}), not Nigeria`,
      detail: { tz, tz_offset_min: offset },
    })
  }

  // --- GPS mock fingerprint. A real GNSS fix outdoors carries altitude and,
  //     when moving, speed/heading. Fake-location apps feed only lat/lng and
  //     leave the rest null. Null alone is weak (indoors can be null too), so
  //     this is only medium and pairs with the other signals in review. ---
  const gps = (input.device_info.gps ?? null) as Record<string, unknown> | null
  if (gps) {
    const nullish = (k: string) => gps[k] === null || gps[k] === undefined
    if (nullish('altitude') && nullish('speed') && nullish('heading')) {
      signals.push({
        kind: 'gps_mock_fingerprint',
        severity: 'medium',
        summary: 'GPS fix had no altitude, speed or heading, as a fake-location app gives',
        detail: { accuracy_m: input.accuracy_m, gps },
      })
    }
  }

  return { signals, ip }
}
