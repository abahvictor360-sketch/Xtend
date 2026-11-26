/**
 * The design floor from the Apple HIG review (2026-11-26): no text below
 * 11 px, every text size in rem so it follows the phone's text-size setting,
 * small text colours at 4.5:1 or more, and the iPhone and Android apps
 * passing the setting on.
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-design-floor.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { rootSizeFor, TEXT_SIZE_SCRIPT } from '@/lib/text-size'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok  : ${label}`)
  else {
    failed++
    console.log(`FAIL: ${label}`, got ?? '')
  }
}
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// Every component outside the video frames (drawn at a fixed size).
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`
    if (p.startsWith('src/components/video')) return []
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}
const px: string[] = []
const small: string[] = []
for (const f of files('src')) {
  const s = read(f)
  for (const m of s.matchAll(/text-\[([0-9.]+)(px|rem)\]/g)) {
    if (m[2] === 'px') px.push(`${f}: ${m[0]}`)
    else if (Number(m[1]) * 16 < 11) small.push(`${f}: ${m[0]}`)
  }
}
check(px.length === 0, 'text sizes are in rem, so they follow the phone\'s text size', px.slice(0, 5))
check(small.length === 0, 'no text below 11 px', small.slice(0, 5))

// Colours, from globals.css.
const css = read('src/app/globals.css')
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*([0-9.]+)\\s+([0-9.]+)%\\s+([0-9.]+)%`))
  if (!m) throw new Error(`no --${name}`)
  return hsl(Number(m[1]), Number(m[2]), Number(m[3]))
}
function hsl(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}
const lum = (c: [number, number, number]) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const white: [number, number, number] = [1, 1, 1]
const fieldBg = hsl(30, 8, 94)
for (const [fg, bg, label] of [
  ['muted-foreground', 'white', 'grey text on white'],
  ['muted-foreground', 'field', 'grey text on the staff app\'s page'],
  ['warning', 'white', 'warning text on white'],
  ['success', 'white', 'success text on white'],
  ['destructive', 'white', 'red text on white'],
  ['brand', 'white', 'brand text on white'],
] as const) {
  const r = ratio(token(fg), bg === 'white' ? white : fieldBg)
  check(r >= 4.5, `${label}: ${r.toFixed(2)}:1, at least 4.5:1`)
}

// The phone's text-size setting.
check(rootSizeFor(17) === 16 && rootSizeFor(34) === 32 && rootSizeFor(60) === 32 && rootSizeFor(12) === 16 && rootSizeFor(0) === null,
  'iPhone: unchanged at the standard size, up to twice as large, never smaller (no zoom on text boxes)')
check(/CSS\.supports\('font','-apple-system-body'\)/.test(TEXT_SIZE_SCRIPT) && /iPhone\|iPad\|iPod/.test(TEXT_SIZE_SCRIPT),
  'only on iPhone and iPad, and only where the system style is known')
check(/__html: TEXT_SIZE_SCRIPT/.test(read('src/app/layout.tsx')), 'the page runs it before it paints')
const main = read('mobile/android/app/src/main/java/ng/xpelbeauty/xtend/MainActivity.java')
check(/setTextZoom\(zoom\)/.test(main) && /fontScale/.test(main) && /public void onResume\(\)[\s\S]{0,120}followTextSize\(\)/.test(main),
  'Android: the WebView follows the phone\'s font size, also after it changes')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL DESIGN FLOOR CHECKS PASSED')
