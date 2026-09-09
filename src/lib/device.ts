'use client'

/**
 * A weak signal, deliberately. It catches a shared login across two handsets,
 * not a determined spoofer.
 */
export function deviceInfo(): Record<string, unknown> {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; downlink?: number }
  }

  return {
    ua: nav.userAgent,
    platform: nav.platform,
    languages: nav.languages?.slice(0, 3),
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}@${devicePixelRatio}` : null,
    cores: nav.hardwareConcurrency ?? null,
    memory_gb: nav.deviceMemory ?? null,
    network: nav.connection?.effectiveType ?? null,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tz_offset_min: new Date().getTimezoneOffset(),
    standalone: typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches,
  }
}
