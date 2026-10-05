/**
 * The Android app the mobile workflow publishes on GitHub
 * (.github/workflows/mobile.yml): the "android" release of this repo,
 * whose xtend.apk is replaced on every build of the production branch.
 *
 * Looked up at most every ten minutes, so the download page keeps well
 * inside GitHub's limit for anonymous requests. Null when the repo is
 * private, nothing is published yet, or GitHub cannot be reached.
 */
const REPO = process.env.APP_RELEASE_REPO || 'abahvictor360-sketch/Xtend'
const TAG = 'android'
const ASSET = 'xtend.apk'

export interface PublishedApk {
  url: string
  version: string | null
}

export async function publishedAndroidApk(): Promise<PublishedApk | null> {
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
    return {
      url: apk.browser_download_url,
      version: release.name?.match(/\d+\.\d+\.\d+/)?.[0] ?? null,
    }
  } catch {
    return null
  }
}
