import 'server-only'
import { createSign, sign as edSign } from 'node:crypto'
import http2 from 'node:http2'
import type { PushPayload } from '@/lib/push'

/**
 * Push to the Xtend Android and iOS apps (mobile/). Web push does not reach
 * an app, so each phone's own service is used:
 *
 *   Android — Firebase Cloud Messaging, HTTP v1.
 *     FIREBASE_SERVICE_ACCOUNT: the service account key JSON from the
 *     Firebase console (Project settings → Service accounts).
 *   iOS — Apple Push Notification service, HTTP/2 with a token key.
 *     APNS_KEY (the .p8 file's contents), APNS_KEY_ID, APNS_TEAM_ID,
 *     APNS_BUNDLE_ID (default ng.xpelbeauty.xtend), APNS_SANDBOX=true for
 *     builds run from Xcode.
 *
 * A device is stored in push_subscriptions with an endpoint of
 * "native-fcm:<token>" or "native-apns:<token>" (migration 030).
 */

export const NATIVE_PREFIX = { android: 'native-fcm:', ios: 'native-apns:' } as const

export function isNativeEndpoint(endpoint: string) {
  return endpoint.startsWith(NATIVE_PREFIX.android) || endpoint.startsWith(NATIVE_PREFIX.ios)
}

export interface NativeOutcome {
  ok: boolean
  /** The token is dead: retire the subscription. */
  gone: boolean
  error?: string
}

/** Everything the app needs, as strings (FCM and APNs data are flat). */
function dataFor(payload: PushPayload): Record<string, string> {
  const data: Record<string, string> = { url: payload.url ?? '/field' }
  if (payload.notificationId) data.notification_id = payload.notificationId
  if (payload.check) {
    data.check_id = payload.check.id
    data.check_token = payload.check.token
  }
  return data
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

// ---------------------------------------------------------------------------
// Firebase Cloud Messaging (Android)
// ---------------------------------------------------------------------------

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

let fcmToken: { value: string; expires: number } | null = null

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ServiceAccount
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') }
  } catch {
    return null
  }
}

async function fcmAccessToken(account: ServiceAccount) {
  if (fcmToken && fcmToken.expires > Date.now() + 60_000) return fcmToken.value
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  })
  if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  fcmToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

async function sendFcm(token: string, payload: PushPayload): Promise<NativeOutcome> {
  const account = serviceAccount()
  if (!account) return { ok: false, gone: false, error: 'FIREBASE_SERVICE_ACCOUNT is not set' }
  const access = await fcmAccessToken(account)
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: dataFor(payload),
          android: {
            priority: 'HIGH',
            ttl: '43200s',
            notification: payload.notificationId ? { tag: payload.notificationId } : undefined,
          },
        },
      }),
    },
  )
  if (res.ok) return { ok: true, gone: false }
  const body = (await res.json().catch(() => null)) as {
    error?: { status?: string; details?: { errorCode?: string }[] }
  } | null
  const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status
  return {
    ok: false,
    gone: res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT',
    error: `Firebase returned ${res.status}${code ? ` ${code}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// Apple Push Notification service (iOS)
// ---------------------------------------------------------------------------

let apnsJwt: { value: string; issued: number } | null = null

function apnsToken() {
  const key = process.env.APNS_KEY?.replace(/\\n/g, '\n')
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  if (!key || !keyId || !teamId) return null
  // Apple accepts a token for an hour and refuses one refreshed too often.
  if (apnsJwt && Date.now() - apnsJwt.issued < 40 * 60_000) return apnsJwt.value
  const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))}.${b64url(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  )}`
  const signature = edSign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
  apnsJwt = { value: `${unsigned}.${b64url(signature)}`, issued: Date.now() }
  return apnsJwt.value
}

function sendApns(token: string, payload: PushPayload): Promise<NativeOutcome> {
  const jwt = apnsToken()
  if (!jwt) return Promise.resolve({ ok: false, gone: false, error: 'APNS_KEY, APNS_KEY_ID or APNS_TEAM_ID is not set' })
  const host =
    process.env.APNS_SANDBOX === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      'thread-id': payload.notificationId,
    },
    ...dataFor(payload),
  })

  return new Promise((resolve) => {
    const client = http2.connect(host)
    client.on('error', (error) => resolve({ ok: false, gone: false, error: error.message }))
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': process.env.APNS_BUNDLE_ID ?? 'ng.xpelbeauty.xtend',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 12 * 3600),
      'content-type': 'application/json',
    })
    let status = 0
    let text = ''
    req.on('response', (headers) => {
      status = Number(headers[':status'])
    })
    req.setEncoding('utf8')
    req.on('data', (chunk) => (text += chunk))
    req.on('end', () => {
      client.close()
      if (status === 200) return resolve({ ok: true, gone: false })
      const reason = (() => {
        try {
          return (JSON.parse(text) as { reason?: string }).reason
        } catch {
          return undefined
        }
      })()
      resolve({
        ok: false,
        gone: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered',
        error: `Apple returned ${status}${reason ? ` ${reason}` : ''}`,
      })
    })
    req.on('error', (error) => {
      client.close()
      resolve({ ok: false, gone: false, error: error.message })
    })
    req.end(body)
  })
}

export async function sendNative(endpoint: string, payload: PushPayload): Promise<NativeOutcome> {
  try {
    if (endpoint.startsWith(NATIVE_PREFIX.android)) {
      return await sendFcm(endpoint.slice(NATIVE_PREFIX.android.length), payload)
    }
    return await sendApns(endpoint.slice(NATIVE_PREFIX.ios.length), payload)
  } catch (error) {
    return { ok: false, gone: false, error: error instanceof Error ? error.message : 'Push failed' }
  }
}

/** Whether the server can push to the apps at all. */
export function nativePushConfigured() {
  return { android: Boolean(serviceAccount()), ios: Boolean(apnsToken()) }
}
