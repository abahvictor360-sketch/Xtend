/**
 * A subscription on one of the push services phones really use. Kept the
 * same as has_live_push() in migration 027: an address typed in by hand
 * does not count as notifications being on.
 */
export const LIVE_PUSH_ENDPOINT =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//
