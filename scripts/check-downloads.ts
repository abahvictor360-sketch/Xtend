import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Downloads work in the browser and in the Android app. The app's WebView
 * drops a download unless told what to do (MainActivity → XtendDownloads),
 * and it can never fetch a blob: or data: link, so files the page builds go
 * through saveBlob (src/lib/save-file.ts). This reads the code that makes
 * that so.
 */
const root = join(__dirname, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok: ${name}`)
}

const java = 'mobile/android/app/src/main/java/ng/xpelbeauty/xtend'
const main = read(`${java}/MainActivity.java`)
const downloads = read(`${java}/XtendDownloads.java`)

check('the app attaches the download handler after the bridge starts', () => {
  assert.match(main, /super\.onCreate\(savedInstanceState\);[\s\S]*XtendDownloads\.attach\(this, getBridge\(\)\.getWebView\(\)\)/)
})
check('links go to Android’s download manager with the session cookie', () => {
  assert.match(downloads, /setDownloadListener\(/)
  assert.match(downloads, /CookieManager\.getInstance\(\)\.getCookie\(url\)/)
  assert.match(downloads, /addRequestHeader\("Cookie", cookie\)/)
  assert.match(downloads, /addRequestHeader\("User-Agent", userAgent\)/)
  assert.match(downloads, /DIRECTORY_DOWNLOADS/)
})
check('only web links are fetched; file names lose any folder', () => {
  assert.match(downloads, /url\.startsWith\("https:\/\/"\) \|\| url\.startsWith\("http:\/\/"\)/)
  assert.match(downloads, /safeName\(URLUtil\.guessFileName/)
  assert.match(downloads, /replaceAll\("\[\\\\\\\\\/:/)
})
check('files the page builds are saved through window.XtendFiles, with a size cap', () => {
  assert.match(downloads, /addJavascriptInterface\(new Bridge\(activity\), "XtendFiles"\)/)
  assert.match(downloads, /@JavascriptInterface\s+public boolean save\(/)
  assert.match(downloads, /bytes\.length > MAX_BYTES/)
})

const saveFile = read('src/lib/save-file.ts')
check('saveBlob uses the app bridge when it is there, a download link otherwise', () => {
  assert.match(saveFile, /XtendFiles/)
  assert.match(saveFile, /if \(app\) return app\.save\(/)
  assert.match(saveFile, /link\.download = name/)
})

const button = read('src/components/admin/staff-logins-button.tsx')
const route = read('src/app/api/admin/staff-logins/route.ts')
check('login sheet: confirm first, then a plain download link (no blob)', () => {
  assert.match(button, /confirmedFetch\(`\$\{SHEET\}\?check=1`\)/)
  assert.match(button, /downloadUrl\(SHEET\)/)
  assert.doesNotMatch(button, /createObjectURL/)
})
check('login sheet: the check answers before anything is built, after the same checks', () => {
  const auth = route.indexOf('requireRecentAuth(await requireApiSession([\'admin\']))')
  const ask = route.indexOf("searchParams.get('check') === '1'")
  const build = route.indexOf('staffLogins(createAdminSupabase())')
  assert.ok(auth >= 0 && ask > auth && build > ask)
})
check('login sheet: links in it use the address the admin is on, not the container’s', () => {
  assert.match(route, /x-forwarded-host/)
  assert.doesNotMatch(route, /const site = new URL\(request\.url\)\.origin/)
})

// Nowhere else builds a blob: or data: download the app could not save.
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    return statSync(join(root, path)).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}
check('no blob: or data: download links outside saveBlob', () => {
  const offenders = files('src').filter((path) => {
    if (relative('src', path) === join('lib', 'save-file.ts')) return false
    const text = read(path)
    return /\.download = /.test(text) || /href=\{`data:/.test(text) || /download="/.test(text)
  })
  assert.deepEqual(offenders, [])
})

console.log(`ALL ${passed} DOWNLOAD CHECKS PASSED`)
