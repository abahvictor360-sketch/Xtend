/**
 * The Android app the mobile workflow publishes on GitHub
 * (.github/workflows/mobile.yml): the "android" release of this repo,
 * whose xtend.apk is replaced on every build of the production branch.
 *
 * Looked up at most every ten minutes, so the download page keeps well
 * inside GitHub's limit for anonymous requests. Null when the repo is
 * private, nothing is published yet, or GitHub cannot be reached.
 */
import { namedCache } from '@/lib/ttl-cache'

const REPO = process.env.APP_RELEASE_REPO || 'abahvictor360-sketch/Xtend'
const TAG = 'android'
const ASSET = 'xtend.apk'

export interface PublishedApk {
  url: string
  version: string | null
  /** The Android versionCode: the workflow's run number, the last part of the version. */
  build: number | null
}

// GitHub allows 60 anonymous calls an hour. Next keeps a good answer for ten
// minutes; this also remembers "nothing there" (a missing tag, a timeout) for
// five, so a broken lookup is not retried on every page's version check.
const apkCache = namedCache<PublishedApk | null>('published-apk', 2)

export async function publishedAndroidApk(): Promise<PublishedApk | null> {
  return apkCache.remember('apk', (v) => (v ? 10 * 60_000 : 5 * 60_000), lookupAndroidApk)
}

async function lookupAndroidApk(): Promise<PublishedApk | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const release = (await res.json()) as {
      name?: string | null
      assets?: { name: string; browser_download_url: string }[]
    }
    const apk = release.assets?.find((a) => a.name === ASSET)
    if (!apk) return null
    const version = release.name?.match(/\d+\.\d+\.\d+/)?.[0] ?? null
    const build = version ? Number(version.split('.')[2]) : NaN
    return {
      url: apk.browser_download_url,
      version,
      build: Number.isFinite(build) ? build : null,
    }
  } catch {
    return null
  }
}
