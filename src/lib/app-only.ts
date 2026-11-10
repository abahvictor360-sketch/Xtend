import { isAppUserAgent } from '@/lib/app-agent'

/**
 * "Use the app" (migration 0084): an admin can require a merchandiser or
 * marketer to use the Xtend phone app. In a browser (or an installed web
 * page) they are sent to a page that tells them to download it, and signing
 * in from a browser is refused. Pure on purpose, so
 * scripts/check-app-only.ts can test it.
 *
 * The apps put "XtendApp" in their user agent. Anyone can send that, so this
 * steers people to the app; it is not a security control.
 */

/** Only these accounts are held to it: office accounts always use the web. */
export const APP_ONLY_ROLES = ['merchandiser', 'marketer'] as const

export const APP_ONLY_MESSAGE =
  'Your account must use the Xtend app. Download it at /download, then sign in there.'
export const APP_ONLY_CODE = 'app_only'
export const APP_ONLY_PATH = '/app-only'

export function appOnlyBlocks(
  profile: { role: string; app_only?: boolean | null } | null | undefined,
  userAgent: string | null | undefined,
): boolean {
  if (!profile || profile.app_only !== true) return false
  if (!(APP_ONLY_ROLES as readonly string[]).includes(profile.role)) return false
  return !isAppUserAgent(userAgent)
}
