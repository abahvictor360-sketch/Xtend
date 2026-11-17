'use client'

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import { callNative, hasPlugin, isNativeApp } from '@/lib/native'
import { confirmedFetch } from '@/components/reconfirm'
import { APP_KEY_SERVER, offerDue, packAppKey, unpackAppKey } from '@/lib/quick-sign-in-rules'

/**
 * Signing in with a fingerprint, face or passkey (0089), on the phone or
 * in the browser. Passkeys are for browsers; the apps keep a secret behind
 * the fingerprint (the NativeBiometric plugin), because the app's built-in
 * browser cannot use passkeys on most phones.
 */

const PLUGIN = 'NativeBiometric'
/** AccessControl.BIOMETRY_ANY: hardware-protected, survives adding a fingerprint. */
const BIOMETRY_ANY = 2
const DECLINED_KEY = 'xtend.quick-sign-in-declined'

export type QuickResult = { ok: true } | { ok: false; error: string; cancelled?: boolean }

async function json(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

/* ---------------- the app: fingerprint or face ---------------- */

/** This phone can use fingerprint or face sign-in in the app. */
export async function appBiometricAvailable(): Promise<boolean> {
  if (!isNativeApp() || !hasPlugin(PLUGIN)) return false
  try {
    const r = await callNative<{ isAvailable: boolean }>(PLUGIN, 'isAvailable', { useFallback: false })
    return r.isAvailable === true
  } catch {
    return false
  }
}

/** Fingerprint sign-in is set up on this phone. */
export async function appKeySaved(): Promise<boolean> {
  if (!isNativeApp() || !hasPlugin(PLUGIN)) return false
  try {
    const r = await callNative<{ isSaved: boolean }>(PLUGIN, 'isCredentialsSaved', { server: APP_KEY_SERVER })
    return r.isSaved === true
  } catch {
    return false
  }
}

async function storeAppKey(keyId: string, secret: string) {
  await callNative(PLUGIN, 'setCredentials', {
    ...packAppKey(keyId, secret),
    server: APP_KEY_SERVER,
    accessControl: BIOMETRY_ANY,
    // One touch both opens the key and stores the next one (Android).
    authValidityDuration: 30,
    title: 'Confirm it is you',
    negativeButtonText: 'Cancel',
  })
}

async function forgetAppKey() {
  await callNative(PLUGIN, 'deleteCredentials', { server: APP_KEY_SERVER }).catch(() => undefined)
}

/** Turns on fingerprint sign-in for this phone (signed in, in the app). */
export async function enrolAppKey(): Promise<QuickResult> {
  const res = await confirmedFetch('/api/auth/biometric/enroll', { method: 'POST' })
  const body = await json(res)
  if (!res.ok) return { ok: false, error: String(body.error ?? 'That did not work. Try again.') }
  const keyId = String(body.key_id)
  try {
    await storeAppKey(keyId, String(body.secret))
    return { ok: true }
  } catch {
    // Not kept on the phone (cancelled, or no fingerprint): undo it.
    await fetch(`/api/auth/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }).catch(() => undefined)
    return { ok: false, error: 'Fingerprint sign-in was not turned on.', cancelled: true }
  }
}

/** Turns it off for this phone: forgotten here and on the server. */
export async function disableAppKey(): Promise<void> {
  try {
    const stored = await callNative<{ username: string; password: string }>(PLUGIN, 'getCredentials', {
      server: APP_KEY_SERVER,
    })
    const key = unpackAppKey(stored)
    if (key) await fetch(`/api/auth/keys/${encodeURIComponent(key.keyId)}`, { method: 'DELETE' }).catch(() => undefined)
  } catch {
    // Nothing readable without the fingerprint: forgetting it here is enough.
  }
  await forgetAppKey()
}

/** Signs in with the fingerprint (on the login page, in the app). */
export async function signInWithAppKey(): Promise<QuickResult> {
  let stored: unknown
  try {
    stored = await callNative(PLUGIN, 'getSecureCredentials', {
      server: APP_KEY_SERVER,
      reason: 'Sign in to Xtend',
      title: 'Sign in to Xtend',
      subtitle: 'Use your fingerprint or face',
      negativeButtonText: 'Use password',
    })
  } catch {
    return { ok: false, error: 'Fingerprint not confirmed. Try again, or use your password.', cancelled: true }
  }
  const key = unpackAppKey(stored as { username?: unknown; password?: unknown })
  if (!key) {
    await forgetAppKey()
    return { ok: false, error: 'Fingerprint sign-in is not set up on this phone. Use your password.' }
  }

  let res: Response
  try {
    res = await fetch('/api/auth/biometric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: key.keyId, secret: key.secret }),
    })
  } catch {
    return { ok: false, error: 'No connection. Check your data and try again.' }
  }
  const body = await json(res)
  if (!res.ok) {
    if (body.code === 'key_gone') await forgetAppKey()
    return { ok: false, error: String(body.error ?? 'That did not work. Use your password.') }
  }
  // Each secret works once: keep the new one for next time.
  if (typeof body.secret === 'string') {
    await storeAppKey(key.keyId, body.secret).catch(() => undefined)
  }
  return { ok: true }
}

/* ---------------- the browser: passkeys ---------------- */

/** This browser can use passkeys (and is not the app). */
export function passkeysSupported(): boolean {
  if (typeof window === 'undefined' || isNativeApp()) return false
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/** This device has its own fingerprint, face or screen lock for passkeys. */
export async function devicePasskeyAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  return platformAuthenticatorIsAvailable().catch(() => false)
}

function passkeyCancelled(err: unknown) {
  const name = err instanceof Error ? err.name : ''
  return name === 'NotAllowedError' || name === 'AbortError'
}

/** Signs in with a passkey (on the login page, in a browser). */
export async function signInWithPasskey(): Promise<QuickResult> {
  try {
    const opts = await fetch('/api/auth/passkey/options', { method: 'POST' })
    const optionsJSON = await json(opts)
    if (!opts.ok) return { ok: false, error: String(optionsJSON.error ?? 'That did not work. Try again.') }
    const response = await startAuthentication({ optionsJSON: optionsJSON as never })
    const res = await fetch('/api/auth/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    })
    const body = await json(res)
    if (!res.ok) return { ok: false, error: String(body.error ?? 'That did not work. Use your password.') }
    return { ok: true }
  } catch (err) {
    if (passkeyCancelled(err)) return { ok: false, error: 'No passkey was used.', cancelled: true }
    return { ok: false, error: 'That did not work. Try again, or use your password.' }
  }
}

/** Adds a passkey for this device (signed in, in a browser). */
export async function addPasskey(): Promise<QuickResult> {
  try {
    const opts = await confirmedFetch('/api/auth/passkey/register/options', { method: 'POST' })
    const optionsJSON = await json(opts)
    if (!opts.ok) return { ok: false, error: String(optionsJSON.error ?? 'That did not work. Try again.') }
    const response = await startRegistration({ optionsJSON: optionsJSON as never })
    const res = await confirmedFetch('/api/auth/passkey/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    })
    const body = await json(res)
    if (!res.ok) return { ok: false, error: String(body.error ?? 'The passkey was not added. Try again.') }
    return { ok: true }
  } catch (err) {
    if (passkeyCancelled(err)) return { ok: false, error: 'The passkey was not added.', cancelled: true }
    if (err instanceof Error && err.name === 'InvalidStateError') {
      return { ok: false, error: 'This device already has a passkey for your account.' }
    }
    return { ok: false, error: 'The passkey was not added. Try again.' }
  }
}

/* ---------------- offering it after a password sign-in ---------------- */

export function offerAllowed(): boolean {
  try {
    const raw = window.localStorage.getItem(DECLINED_KEY)
    return offerDue(raw ? Number(raw) : null, Date.now())
  } catch {
    return true
  }
}

export function declineOffer() {
  try {
    window.localStorage.setItem(DECLINED_KEY, String(Date.now()))
  } catch {
    // Private window: it is simply offered again next time.
  }
}
