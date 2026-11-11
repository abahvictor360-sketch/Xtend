/**
 * The Xtend apps (mobile/) add this to their user agent, so a server page
 * can tell them from a browser. Not a security signal: anyone can send it.
 */
export const APP_AGENT_MARK = 'XtendApp'

export const isAppUserAgent = (ua: string | null | undefined) =>
  Boolean(ua && ua.includes(APP_AGENT_MARK))

/**
 * Set by the middleware on any request that carries the app's mark, and
 * sent back on every request after. Needed because Android's WebView sends
 * the page loads its service worker makes (public/sw.js) with the plain
 * WebView user agent, without "XtendApp", so those alone looked like a
 * browser. Still not a security signal.
 */
export const APP_COOKIE = 'xt_app'
/** A year: the mark is renewed on every request the app makes. */
export const APP_COOKIE_MAX_AGE = 365 * 24 * 3600

/** From the app: its user agent, or the cookie an earlier app request left. */
export const isAppRequest = (ua: string | null | undefined, appCookie: string | null | undefined) =>
  isAppUserAgent(ua) || appCookie === '1'
