/**
 * A subscription on one of the push services phones really use, or a token
 * from the Xtend Android or iOS app. Kept the same as has_live_push() in
 * migrations 027 and 030: an address typed in by hand does not count as
 * notifications being on.
 */
export const LIVE_PUSH_ENDPOINT =
  /^(https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\/|native-(fcm|apns):[A-Za-z0-9_:-]{20,})/

/** The push services browsers really use. Nothing else is ever sent to. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$/,
]

/** A push token from the Xtend Android or iOS app, after its prefix. */
export const NATIVE_TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/

/**
 * Whether a browser's push address is one of the real push services. The
 * server POSTs to whatever address a device registers, so anything else
 * (an address inside the server's own network, say) is refused when it is
 * registered and again before every send. HTTPS on the standard port, no
 * user name or password in it, and one of the hosts above.
 */
export function isWebPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  )
}
