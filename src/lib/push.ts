import 'server-only'
import webpush, { type PushSubscription, type WebPushError } from 'web-push'

let configured = false

/**
 * Web Push needs a VAPID key pair to identify this application server to
 * Chrome's and Mozilla's push services. The public half is also shipped to
 * the browser so it can create a subscription.
 */
function configure() {
  if (configured) return true

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:ops@xpelbeauty.ng',
    publicKey,
    privateKey,
  )
  configured = true
  return true
}

export function pushConfigured() {
  return configure()
}

export interface PushTarget {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushOutcome {
  subscriptionId: string
  userId: string
  ok: boolean
  /** Set when the subscription is dead and should be deactivated. */
  gone: boolean
  error?: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string | null
  notificationId?: string
}

/**
 * Sends one payload to one device. A 404 or 410 means the browser has thrown
 * the subscription away — that is not a failure to report to the sender, it
 * is a row to retire.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
  if (!configure()) {
    return {
      subscriptionId: target.id,
      userId: target.user_id,
      ok: false,
      gone: false,
      error: 'Push is not configured on the server',
    }
  }

  const subscription: PushSubscription = {
    endpoint: target.endpoint,
    keys: { p256dh: target.p256dh, auth: target.auth },
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 12 * 60 * 60,
      urgency: 'high',
    })
    return { subscriptionId: target.id, userId: target.user_id, ok: true, gone: false }
  } catch (error) {
    const status = (error as WebPushError)?.statusCode
    return {
      subscriptionId: target.id,
      userId: target.user_id,
      ok: false,
      gone: status === 404 || status === 410,
      error: status ? `Push service returned ${status}` : (error as Error).message,
    }
  }
}
