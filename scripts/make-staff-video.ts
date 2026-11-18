/**
 * Makes the staff video guide: public/guide/xtend-staff-guide.mp4 (1080×1920,
 * for phones and WhatsApp) and its poster, from the scenes in
 * src/components/video/staff-video-scenes.tsx, with fresh pictures of the
 * download and sign-in pages (public/guide/staff-download.png, staff-login.png).
 *
 * Needs a development server (the scene page is development-only) and
 * ffmpeg:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next dev -p 3128
 *   SCENE_URL=http://127.0.0.1:3128 npx tsx --tsconfig tsconfig.scripts.json scripts/make-staff-video.ts
 *
 * With VOICE_DIR set, it adds the voice-over (VOICE in the scenes file),
 * spoken on this computer by scripts/staff-video-voice.py: VOICE_DIR holds
 * kokoro.onnx, voices.bin and a Python venv/ with kokoro-onnx and
 * soundfile (see that file). Each scene then lasts as long as its words.
 *
 * Run it again whenever the app's screens or words change.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const BASE = process.env.SCENE_URL ?? 'http://127.0.0.1:3128'
const OUT = join(__dirname, '..', 'public', 'guide')
const FADE = 0.35
/** Silence before the voice starts on a scene, and after it ends. */
const LEAD = 0.45
const TAIL = 0.9
const VOICE_DIR = process.env.VOICE_DIR ?? null

// Playwright comes with the machine (it is not one of Xtend's packages).
interface Shooter {
  launch(): Promise<{
    newPage(o: object): Promise<{
      goto(url: string, o: object): Promise<unknown>
      addStyleTag(o: { content: string }): Promise<unknown>
      screenshot(o: { path: string }): Promise<unknown>
      waitForTimeout(ms: number): Promise<void>
      locator(sel: string): { innerText(): Promise<string>; screenshot(o: { path: string }): Promise<unknown> }
    }>
    close(): Promise<void>
  }>
}
const { chromium } = createRequire(__filename)('playwright') as { chromium: Shooter }

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'xtend-video-'))
  try {
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })
    // Hide the development badge in every shot.
    const hideDev = 'nextjs-portal{display:none!important}'
    // The download and sign-in pages, as a phone sees them (the scenes show them).
    const phone = await browser.newPage({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2 })
    for (const [path, file] of [['/download', 'staff-download.png'], ['/login', 'staff-login.png']]) {
      await phone.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 180_000 })
      await phone.addStyleTag({ content: hideDev })
      await phone.waitForTimeout(3500)
      await phone.screenshot({ path: join(OUT, file) })
    }
    await page.goto(`${BASE}/guide/video-scenes?list=1`, { waitUntil: 'networkidle', timeout: 180_000 })
    const SCENES = JSON.parse(await page.locator('#list').innerText()) as { id: string; seconds: number; chapter: string; say: string }[]
    for (const [i, scene] of SCENES.entries()) {
      await page.goto(`${BASE}/guide/video-scenes?s=${scene.id}`, { waitUntil: 'networkidle', timeout: 180_000 })
      // Fonts, pictures and the pages shown inside frames.
      await page.addStyleTag({ content: hideDev })
      await page.waitForTimeout(1200)
      await page.locator('#scene').screenshot({ path: join(work, `${String(i).padStart(3, '0')}.png`) })
      process.stdout.write(`${scene.id} `)
    }
    await browser.close()
    console.log()

    // The voice-over: one recording per scene, and each scene as long as
    // its words (never shorter than its own length).
    const voiced = Boolean(VOICE_DIR)
    if (voiced) {
      execFileSync(join(VOICE_DIR!, 'venv', 'bin', 'python'), ['-I', join(__dirname, 'staff-video-voice.py'), VOICE_DIR!, work], {
        input: JSON.stringify(SCENES.map((x) => ({ id: x.id, say: x.say }))),
        stdio: ['pipe', 'inherit', 'inherit'],
      })
      for (const x of SCENES) {
        const wav = join(work, `${x.id}.wav`)
        if (!existsSync(wav)) continue
        const said = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString())
        x.seconds = Math.max(x.seconds, Math.ceil((LEAD + said + TAIL) * 10) / 10)
      }
    }

    // One clip per scene, fading in and out, then joined.
    const list: string[] = []
    const total = SCENES.reduce((t, x) => t + x.seconds, 0)
    // Where each chapter starts, for the guide's chapter buttons.
    const chapters: { title: string; at: number }[] = []
    let at = 0
    for (const x of SCENES) {
      if (x.chapter) chapters.push({ title: x.chapter, at: Math.round(at * 10) / 10 })
      at += x.seconds
    }
    writeFileSync(
      join(__dirname, '..', 'src', 'lib', 'staff-video.ts'),
      `// Made by scripts/make-staff-video.ts: do not edit by hand.\n\n` +
        `/** The staff video guide, its length and where each chapter starts (seconds). */\n` +
        `export const STAFF_VIDEO = {\n  src: '/guide/xtend-staff-guide.mp4',\n  poster: '/guide/xtend-staff-guide.jpg',\n  seconds: ${Math.round(total)},\n  chapters: ${JSON.stringify(chapters, null, 2).replace(/\n/g, '\n  ')},\n} as const\n`,
    )
    for (const [i, scene] of SCENES.entries()) {
      const n = String(i).padStart(3, '0')
      const clip = join(work, `${n}.mp4`)
      const wav = join(work, `${scene.id}.wav`)
      // Every clip has a sound track (silence when nothing is said), so they join cleanly.
      const sound = voiced && existsSync(wav)
        ? ['-i', wav, '-filter_complex', `[1:a]adelay=${Math.round(LEAD * 1000)}:all=1,apad,atrim=0:${scene.seconds},aresample=48000[a]`, '-map', '0:v', '-map', '[a]']
        : ['-f', 'lavfi', '-t', String(scene.seconds), '-i', 'anullsrc=r=48000:cl=mono', '-map', '0:v', '-map', '1:a']
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-t', String(scene.seconds), '-i', join(work, `${n}.png`),
        ...sound,
        '-vf', `scale=1080:1920,format=yuv420p,fade=t=in:st=0:d=${FADE}:color=white,fade=t=out:st=${scene.seconds - FADE}:d=${FADE}:color=white`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-r', '30',
        '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '48000', '-t', String(scene.seconds), clip,
      ])
      list.push(`file '${clip}'`)
    }
    writeFileSync(join(work, 'list.txt'), list.join('\n'))
    mkdirSync(OUT, { recursive: true })
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', // Speech at the usual loudness for phone speakers.
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-movflags', '+faststart',
      join(OUT, 'xtend-staff-guide.mp4'),
    ])
    // The poster: the opening card, small.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(work, '000.png'), '-vf', 'scale=540:960', join(OUT, 'xtend-staff-guide.jpg')])
    console.log(`Wrote public/guide/xtend-staff-guide.mp4 (${Math.floor(total / 60)} min ${Math.round(total % 60)} s${voiced ? ', with the voice-over' : ''}) and its poster.`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
