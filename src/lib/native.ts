'use client'

/**
 * The bridge to the Xtend Android and iOS apps (mobile/, Capacitor).
 *
 * The apps load this same site in a native shell, which injects
 * window.Capacitor. Through it the site reaches what a browser cannot:
 * location while the screen is off or the app is in the background, and
 * native push. In an ordinary browser none of this exists and every helper
 * here is a no-op, so the site behaves exactly as before.
 */

type NativeCallback = (data: unknown, error?: { message?: string }) => void

interface CapacitorBridge {
  nativePromise: (plugin: string, method: string, options?: unknown) => Promise<unknown>
  nativeCallback: (plugin: string, method: string, options: unknown, cb: NativeCallback) => string
  addListener: (
    plugin: string,
    event: string,
    cb: (data: never) => void,
  ) => { remove: () => Promise<void> }
  isPluginAvailable?: (name: string) => boolean
}

function bridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  const cap = (window as unknown as { Capacitor?: Partial<CapacitorBridge> }).Capacitor
  if (!cap?.nativePromise || !cap.nativeCallback || !cap.addListener) return null
  return cap as CapacitorBridge
}

export type NativePlatform = 'android' | 'ios'

/** 'android' or 'ios' inside the Xtend app; null in a browser. */
export function nativePlatform(): NativePlatform | null {
  if (typeof window === 'undefined' || !bridge()) return null
  const w = window as unknown as { androidBridge?: unknown; webkit?: { messageHandlers?: { bridge?: unknown } } }
  if (w.androidBridge) return 'android'
  if (w.webkit?.messageHandlers?.bridge) return 'ios'
  return null
}

export const isNativeApp = () => nativePlatform() !== null

export function hasPlugin(name: string) {
  const cap = bridge()
  return Boolean(cap && (cap.isPluginAvailable ? cap.isPluginAvailable(name) : true))
}

export async function callNative<T>(plugin: string, method: string, options: unknown = {}): Promise<T> {
  const cap = bridge()
  if (!cap) throw new Error('Not running in the Xtend app')
  return (await cap.nativePromise(plugin, method, options)) as T
}

export function listenNative<T>(plugin: string, event: string, cb: (data: T) => void) {
  const cap = bridge()
  if (!cap) return { remove: async () => {} }
  return cap.addListener(plugin, event, cb as (data: never) => void)
}

// ---------------------------------------------------------------------------
// Background location (@capacitor-community/background-geolocation)
// ---------------------------------------------------------------------------

export interface NativeLocation {
  latitude: number
  longitude: number
  accuracy: number
  time: number | null
}

/**
 * Starts location updates that keep coming with the screen off. Android
 * shows its required "Xtend / On shift" notification meanwhile. Returns a
 * stop function, or null in a browser.
 */
export function watchBackgroundLocation(
  onLocation: (location: NativeLocation) => void,
  onError?: (code: string) => void,
): (() => void) | null {
  const cap = bridge()
  if (!cap || !hasPlugin('BackgroundGeolocation')) return null
  let id: string | null = null
  let stopped = false
  try {
    id = cap.nativeCallback(
      'BackgroundGeolocation',
      'addWatcher',
      {
        backgroundTitle: 'Xtend',
        backgroundMessage: 'On shift',
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (data, error) => {
        if (stopped) return
        if (error) {
          onError?.((error as { code?: string }).code ?? 'ERROR')
          return
        }
        if (data) onLocation(data as NativeLocation)
      },
    )
  } catch {
    return null
  }
  return () => {
    stopped = true
    if (id) void cap.nativePromise('BackgroundGeolocation', 'removeWatcher', { id }).catch(() => {})
  }
}

/**
 * A POST that keeps working with the app in the background. On Android the
 * WebView's own requests are throttled after five minutes there, so the
 * native HTTP client is used; it shares the WebView's sign-in cookies.
 */
export async function nativePostJson(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const url = new URL(path, window.location.origin).toString()
  if (nativePlatform() === 'android' && hasPlugin('CapacitorHttp')) {
    const res = await callNative<{ status: number; data: unknown }>('CapacitorHttp', 'request', {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
    })
    return { status: res.status, data: res.data }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

// ---------------------------------------------------------------------------
// Push notifications (@capacitor/push-notifications)
// ---------------------------------------------------------------------------

export type NativePushPermission = 'granted' | 'denied' | 'prompt'

export async function nativePushPermission(request = false): Promise<NativePushPermission> {
  const res = await callNative<{ receive: string }>(
    'PushNotifications',
    request ? 'requestPermissions' : 'checkPermissions',
  )
  return res.receive === 'granted' ? 'granted' : res.receive === 'denied' ? 'denied' : 'prompt'
}

/**
 * Registers this phone with Firebase (Android) or Apple (iOS) and gives
 * the token to the server. Resolves true once the server has it.
 */
export async function registerNativePush(): Promise<boolean> {
  const platform = nativePlatform()
  if (!platform) return false
  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('This phone did not answer. Try again.')), 20_000)
    const ok = listenNative<{ value: string }>('PushNotifications', 'registration', (t) => {
      clearTimeout(timer)
      void ok.remove()
      void failed.remove()
      resolve(t.value)
    })
    const failed = listenNative<{ error: string }>('PushNotifications', 'registrationError', (e) => {
      clearTimeout(timer)
      void ok.remove()
      void failed.remove()
      reject(new Error(e.error || 'Notifications could not be set up on this phone.'))
    })
    callNative('PushNotifications', 'register').catch((error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  const res = await fetch('/api/push/native', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, token }),
  })
  return res.ok
}
