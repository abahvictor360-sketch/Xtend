'use client'

/**
 * Bridge to the native shell.
 *
 * Xtend ships as one web app. On a phone it can also run inside a thin
 * Capacitor wrapper (see /native) that loads this same site and injects a
 * `LocationIntegrity` plugin the browser cannot provide: Android's hard
 * mock-location flag, and a root / jailbreak check.
 *
 * Everything here is accessed through the `window.Capacitor` global that the
 * shell injects, so the web build takes no Capacitor dependency and in a plain
 * browser every function below simply reports "not native" and changes
 * nothing. The server treats whatever comes back as one more signal, never as
 * proof on its own.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: Record<string, unknown>
}

interface LocationIntegrityPlugin {
  getFix: () => Promise<NativeFix>
}

export interface NativeFix {
  lat: number
  lng: number
  accuracy_m: number
  altitude: number | null
  speed: number | null
  heading: number | null
  /** Android: location came from a mock provider. iOS: always false. */
  is_mock: boolean
  /** Rooted (Android) or jailbroken (iOS): the OS integrity is compromised. */
  compromised: boolean
  platform: 'android' | 'ios'
  captured_at: string
}

function cap(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null
}

/** True only inside the native shell. */
export function isNativeApp(): boolean {
  const c = cap()
  return Boolean(c?.isNativePlatform?.())
}

export function nativePlatform(): string | null {
  const c = cap()
  return c?.isNativePlatform?.() ? (c.getPlatform?.() ?? null) : null
}

function plugin(): LocationIntegrityPlugin | null {
  const c = cap()
  const p = c?.Plugins?.LocationIntegrity as LocationIntegrityPlugin | undefined
  return p && typeof p.getFix === 'function' ? p : null
}

/**
 * A location fix from the native layer, with the mock / integrity flags.
 * Returns null when not running in the shell, or the plugin is unavailable,
 * so the caller falls back to the browser's Geolocation API.
 */
export async function getNativeFix(): Promise<NativeFix | null> {
  const p = plugin()
  if (!p) return null
  try {
    const fix = await p.getFix()
    if (!Number.isFinite(fix?.lat) || !Number.isFinite(fix?.lng)) return null
    return fix
  } catch {
    return null
  }
}

/**
 * The native block folded into device_info at submit time. Empty in a plain
 * browser. The server reads device_info.native to raise mock_location_confirmed
 * and device_integrity_failed.
 */
export function nativeDeviceSignals(fix: NativeFix | null): Record<string, unknown> {
  const platform = nativePlatform()
  if (!platform) return {}
  return {
    native: {
      platform,
      is_mock: fix?.is_mock ?? null,
      compromised: fix?.compromised ?? null,
    },
  }
}
