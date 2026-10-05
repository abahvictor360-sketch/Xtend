/**
 * The Xtend apps (mobile/) add this to their user agent, so a server page
 * can tell them from a browser. Not a security signal: anyone can send it.
 */
export const APP_AGENT_MARK = 'XtendApp'

export const isAppUserAgent = (ua: string | null | undefined) =>
  Boolean(ua && ua.includes(APP_AGENT_MARK))
