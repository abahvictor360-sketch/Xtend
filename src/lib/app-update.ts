/**
 * Deciding what to tell someone about updates. Shared by the server
 * (/api/version) and the browser (UpdateManager); pure, so
 * scripts/check-updates.ts can exercise it.
 *
 * Two kinds of update:
 *   - the site: every phone and browser runs the live site, so a new deploy
 *     only needs the page reloaded. A page knows its own build id
 *     (NEXT_PUBLIC_BUILD_ID) and compares it with the server's;
 *   - the phone app itself (the Android APK or the iPhone app), which needs
 *     installing. Only needed when something native changed, such as the
 *     shift tracker. An admin can set the lowest build still allowed.
 */

export interface ReleaseNote {
  id: string
  title: string
  notes: string
  required: boolean
  created_at: string
}

export interface VersionInfo {
  /** The build the server is running now. */
  build: string
  android: { latest_build: number | null; latest_version: string | null; minimum: number | null; url: string }
  ios: { latest_build: number | null; minimum: number | null; url: string | null }
  /** The newest "What's new" for this person, if signed in. */
  release: ReleaseNote | null
}

export type UpdateLevel = 'current' | 'available' | 'required'

export interface UpdateState {
  site: UpdateLevel
  app: UpdateLevel
  /** Where to get the new phone app. */
  appUrl: string | null
  appVersion: string | null
}

/** "1.0.53" or "53" → 53; anything else → null. */
export function buildNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const last = value.trim().split('.').pop()!
  const n = Number(last)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function decideUpdate(
  info: VersionInfo,
  local: { build: string; platform: 'android' | 'ios' | null; appBuild: number | null },
): UpdateState {
  const siteNewer = Boolean(info.build) && Boolean(local.build) && info.build !== local.build
  const site: UpdateLevel = !siteNewer ? 'current' : info.release?.required ? 'required' : 'available'

  let app: UpdateLevel = 'current'
  let appUrl: string | null = null
  let appVersion: string | null = null
  if (local.platform && local.appBuild != null) {
    const p = local.platform === 'android' ? info.android : info.ios
    appUrl = p.url
    appVersion = local.platform === 'android' ? info.android.latest_version : null
    if (p.minimum != null && local.appBuild < p.minimum) app = 'required'
    else if (p.latest_build != null && local.appBuild < p.latest_build) app = 'available'
  }
  // Nowhere to get it from: do not ask for the impossible.
  if (app !== 'current' && !appUrl) app = 'current'
  return { site, app, appUrl, appVersion }
}

/** Only recent notes are worth showing to someone who has not seen them. */
export const NOTES_FRESH_DAYS = 14

export function shouldShowNotes(release: ReleaseNote | null, seenId: string | null, now = Date.now()) {
  if (!release || release.id === seenId) return false
  return now - Date.parse(release.created_at) <= NOTES_FRESH_DAYS * 86_400_000
}

export type InstallStatus = 'current' | 'old_site' | 'old_app' | 'must_update'

/**
 * Where one person's phone stands, for the Updates page: below the lowest
 * build allowed, an older app than the newest, or the newest app but not
 * yet reloaded onto the newest site.
 */
export function installStatus(
  install: { platform: string; app_build: number | null; web_build: string | null },
  live: { build: string; android: { latest: number | null; minimum: number | null }; ios: { latest: number | null; minimum: number | null } },
): InstallStatus {
  const p = install.platform === 'android' ? live.android : install.platform === 'ios' ? live.ios : null
  if (p && install.app_build != null) {
    if (p.minimum != null && install.app_build < p.minimum) return 'must_update'
    if (p.latest != null && install.app_build < p.latest) return 'old_app'
  }
  if (install.web_build && live.build && install.web_build !== live.build) return 'old_site'
  return 'current'
}
