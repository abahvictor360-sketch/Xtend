import 'server-only'
import { createECDH } from 'node:crypto'
import webpush, { type PushSubscription, type WebPushError } from 'web-push'
import { isNativeEndpoint, sendNative } from '@/lib/push-native'

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
  /** A phone check: the service worker reports back that it arrived. */
  check?: { id: string; token: string }
}

/**
 * Sends one payload to one device. A 404 or 410 means the browser has thrown
 * the subscription away — that is not a failure to report to the sender, it
 * is a row to retire.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
  // The Xtend Android and iOS apps: Firebase or Apple, not web push.
  if (isNativeEndpoint(target.endpoint)) {
    const outcome = await sendNative(target.endpoint, payload)
    return { subscriptionId: target.id, userId: target.user_id, ...outcome }
  }

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

export interface VapidStatus {
  /** Both halves of the key pair are present in the environment. */
  present: boolean
  /** They are well-formed keys of the right curve and length. */
  well_formed: boolean
  /** The public key is genuinely the one derived from the private key. */
  matched: boolean
  /** The `mailto:` or `https:` identity sent with every push. */
  subject_valid: boolean
  problem: string | null
}

/**
 * Checks the VAPID configuration properly, rather than checking that two
 * environment variables are non-empty.
 *
 * The mismatch worth catching is a public and a private key from two
 * different generator runs: everything looks configured, browsers accept
 * the subscription, and every send is rejected with a signature error. So
 * the public point is derived from the private scalar and compared.
 */
export function vapidStatus(): VapidStatus {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:ops@xpelbeauty.ng'

  const status: VapidStatus = {
    present: Boolean(publicKey && privateKey),
    well_formed: false,
    matched: false,
    subject_valid: /^(mailto:.+@.+|https:\/\/.+)$/.test(subject),
    problem: null,
  }

  if (!status.present) {
    status.problem = 'NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is not set'
    return status
  }

  try {
    // web-push checks length and curve for us and throws on anything else.
    webpush.setVapidDetails(subject, publicKey!, privateKey!)
    status.well_formed = true
  } catch (error) {
    status.problem = error instanceof Error ? error.message : 'Invalid VAPID keys'
    return status
  }

  try {
    const key = createECDH('prime256v1')
    key.setPrivateKey(Buffer.from(privateKey!, 'base64url'))
    const derived = key.getPublicKey().toString('base64url')
    status.matched = derived === publicKey!.replace(/=+$/, '')
    if (!status.matched) {
      status.problem = 'The public key is not the pair of the private key — regenerate both'
    }
  } catch (error) {
    status.problem = error instanceof Error ? error.message : 'Could not verify the key pair'
  }

  if (!status.subject_valid && !status.problem) {
    status.problem = 'VAPID_SUBJECT must be a mailto: address or an https: URL'
  }

  return status
}
