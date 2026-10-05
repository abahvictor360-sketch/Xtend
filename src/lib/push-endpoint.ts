/**
 * A subscription on one of the push services phones really use, or a token
 * from the Xtend Android or iOS app. Kept the same as has_live_push() in
 * migrations 027 and 030: an address typed in by hand does not count as
 * notifications being on.
 */
export const LIVE_PUSH_ENDPOINT =
  /^(https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\/|native-(fcm|apns):[A-Za-z0-9_:-]{20,})/
