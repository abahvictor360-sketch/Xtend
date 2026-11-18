'use client'

import { useRef } from 'react'
import { Download, PlayCircle } from 'lucide-react'
import { STAFF_VIDEO } from '@/lib/staff-video'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * The staff video guide at the top of the guide (/guide and in the app):
 * the video, a button per chapter that jumps to it, and a download to
 * share it (on WhatsApp, for example).
 */
export function StaffVideo() {
  const video = useRef<HTMLVideoElement>(null)
  const jump = (at: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = at
    void v.play().catch(() => {})
    v.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  return (
    <section id="video" className="surface scroll-mt-24 space-y-4 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="icon-tile">
          <PlayCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight">Watch: Xtend step by step</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {clock(STAFF_VIDEO.seconds)} minutes, spoken and written, so it works with the sound on or off. Getting the app, switching on location and battery,
            clocking in, store visits and clocking out. Tap a step to jump to it.
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
        <video
          ref={video}
          controls
          playsInline
          preload="metadata"
          poster={STAFF_VIDEO.poster}
          className="mx-auto aspect-[9/16] w-full max-w-[320px] rounded-2xl border border-border bg-black"
        >
          <source src={STAFF_VIDEO.src} type="video/mp4" />
        </video>
        <div className="space-y-2">
          <ol className="grid gap-1.5">
            {STAFF_VIDEO.chapters.map((c, i) => (
              <li key={c.title}>
                <button
                  type="button"
                  onClick={() => jump(c.at)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left text-sm hover:border-brand/40 hover:bg-tint"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-brand">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">{c.title}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{clock(c.at)}</span>
                </button>
              </li>
            ))}
          </ol>
          <a
            href={`${STAFF_VIDEO.src}?download=1`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-tint"
          >
            <Download className="h-4 w-4" /> Download the video to share
          </a>
        </div>
      </div>
    </section>
  )
}
