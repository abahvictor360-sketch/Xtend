'use client'

import { CheckCircle2, Lock, Power, Smartphone } from 'lucide-react'
import { BackgroundGate } from '@/components/field/background-gate'
import { Big, ClockButton, Done, type Scene, type VideoSet } from '@/components/video/staff-video-scenes'
import { cn } from '@/lib/utils'

/**
 * The short video for TECNO, Infinix and itel phones
 * (public/guide/xtend-tecno-setup.mp4): turn on Auto-start for Xtend, lock
 * it in the recent apps, then tap "I did both". Made like the staff video
 * (scripts/make-staff-video.ts with VIDEO=tecno). Phone screens are plain
 * drawings: Phone Master and the recent apps look a little different on
 * each phone. It says what to do, never why beyond "so Xtend keeps working".
 */

export const TECNO_CHAPTERS = ['Turn on Auto-start', 'Lock Xtend in recent apps', 'Tell Xtend you are done'] as const
const C = TECNO_CHAPTERS

/** Xtend's own setup card on a TECNO phone, as staff see it. */
function MakerCard() {
  return (
    <div className="p-3">
      <BackgroundGate
        state={{ platform: 'android', always: true, batteryUnrestricted: true, maker: 'tecno' }}
        needs={{ always: false, battery: false, maker: true, blocked: true }}
        action="clock in"
        onDone={() => {}}
        onConfirmMaker={() => {}}
      />
    </div>
  )
}

/** Phone Master's Auto-start list (a plain drawing). */
function AutoStartList({ on }: { on: boolean }) {
  const apps = [
    { name: 'WhatsApp', on: true },
    { name: 'Xtend', on },
    { name: 'Facebook', on: false },
    { name: 'Chrome', on: false },
  ]
  return (
    <div className="h-full bg-[#f6f7fb] text-[#1d1b20]">
      <div className="bg-[#2f6bff] px-5 pb-5 pt-7 text-white">
        <p className="text-xs opacity-80">Phone Master</p>
        <p className="mt-1 text-2xl font-semibold">Auto-start</p>
        <p className="mt-1 text-sm opacity-90">Allow apps to start by themselves</p>
      </div>
      <div className="space-y-2 p-4">
        {apps.map((a) => (
          <div key={a.name} className={cn('flex items-center gap-3 rounded-2xl bg-white px-4 py-4 shadow-sm', a.name === 'Xtend' && 'ring-2 ring-[#2f6bff]/40')}>
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold', a.name === 'Xtend' ? 'brand-surface text-white' : 'bg-[#e3e6ee] text-[#5f6577]')}>
              {a.name[0]}
            </span>
            <span className="flex-1 text-[16px] font-medium">{a.name}</span>
            <span
              data-tap={a.name === 'Xtend' ? 'xtend-switch' : undefined}
              className={cn('flex h-7 w-12 items-center rounded-full p-1 transition-colors', a.on ? 'justify-end bg-[#2f6bff]' : 'justify-start bg-[#c9cdd8]')}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The recent apps screen (a plain drawing), with Xtend locked or not. */
function RecentApps({ locked, pulling }: { locked: boolean; pulling?: boolean }) {
  return (
    <div className="flex h-full flex-col bg-[#20232b] px-6 pb-8 pt-10 text-white">
      <p className="text-center text-sm text-white/70">Recent apps</p>
      <div className="mt-8 flex flex-1 items-start justify-center gap-4">
        <div className="mt-6 h-[300px] w-[110px] rounded-3xl bg-white/15" />
        <div
          data-tap="xtend-card"
          className={cn('relative w-[170px] rounded-3xl bg-white text-[#1d1b20] shadow-2xl transition-transform', pulling && 'translate-y-10')}
        >
          <div className="flex items-center gap-2 border-b border-black/10 px-3 py-2">
            <span className="brand-surface flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold text-white">X</span>
            <span className="text-sm font-semibold">Xtend</span>
            {locked && <Lock className="ml-auto h-4 w-4 text-[#2f6bff]" />}
          </div>
          <div className="space-y-2 p-3">
            <div className="h-3 w-24 rounded bg-black/10" />
            <div className="h-16 rounded-xl bg-[#fdebd8]" />
            <div className="h-10 rounded-full bg-[#d1511a]" />
            <div className="h-3 w-20 rounded bg-black/10" />
          </div>
        </div>
        <div className="mt-6 h-[300px] w-[110px] rounded-3xl bg-white/15" />
      </div>
      {pulling && <p className="text-center text-sm text-white/80">↓ Pull Xtend down until a lock shows</p>}
      {locked && (
        <p className="flex items-center justify-center gap-2 text-center text-sm text-white/90">
          <Lock className="h-4 w-4" /> Xtend is locked
        </p>
      )}
    </div>
  )
}

export const TECNO_SCENES: Scene[] = [
  {
    id: 'intro', chapter: '', title: 'TECNO, Infinix or itel phone?',
    sub: 'Two quick settings so Xtend keeps working when your screen is off. You do this once.', seconds: 5, screen: null, card: true,
  },
  {
    id: 'card', chapter: C[0], title: 'Xtend asks you to set up your phone',
    sub: 'Before you can clock in, you see “Auto-start and lock Xtend”.', seconds: 6,
    screen: <MakerCard />,
  },

  // 1 Auto-start
  { id: 'c1', chapter: C[0], title: C[0], sub: 'Step 1', seconds: 3, screen: null, card: true },
  {
    id: 'open', chapter: C[0], title: 'Tap “Open Auto-start”', sub: 'Phone Master opens on its Auto-start list.', seconds: 6,
    screen: <MakerCard />, tap: 'Open Auto-start',
  },
  {
    id: 'switch', chapter: C[0], title: 'Turn on Xtend', sub: 'Find Xtend in the list and switch it on.', seconds: 6,
    screen: <AutoStartList on={false} />, tap: 'xtend-switch',
  },
  {
    id: 'switched', chapter: C[0], title: 'Xtend is on', sub: 'No button? Open Phone Master yourself, then App management or Auto-start.', seconds: 6,
    screen: <AutoStartList on />,
  },

  // 2 Lock
  { id: 'c2', chapter: C[1], title: C[1], sub: 'Step 2', seconds: 3, screen: null, card: true },
  {
    id: 'recents', chapter: C[1], title: 'Open your recent apps', sub: 'Tap the square button, or swipe up from the bottom and hold.', seconds: 6,
    screen: <Big icon={Smartphone}>Tap the <b>square</b> button, or <b>swipe up</b> from the bottom of the screen and hold.</Big>,
  },
  {
    id: 'pull', chapter: C[1], title: 'Pull Xtend down', sub: 'Pull the Xtend card down until a lock shows on it.', seconds: 7,
    screen: <RecentApps locked={false} pulling />, tap: 'xtend-card',
  },
  {
    id: 'locked', chapter: C[1], title: 'A lock shows on Xtend', sub: 'Now the phone will not close Xtend by itself.', seconds: 6,
    screen: <RecentApps locked />,
  },

  // 3 Confirm
  { id: 'c3', chapter: C[2], title: C[2], sub: 'Step 3', seconds: 3, screen: null, card: true },
  {
    id: 'confirm', chapter: C[2], title: 'Come back and tap “I did both”', sub: 'Xtend remembers it on this phone.', seconds: 6,
    screen: <MakerCard />, tap: 'I did both',
  },
  {
    id: 'ready', chapter: C[2], title: 'Now clock in as usual', sub: 'Open Xtend at your store and clock in with your selfie.', seconds: 6,
    screen: (
      <div className="space-y-4">
        <Done title="All set" line="Clock in at your store" />
        <div className="px-4">
          <ClockButton />
        </div>
      </div>
    ),
  },

  {
    id: 'end', chapter: '', title: 'You are ready',
    sub: 'Changed phone, or reinstalled Xtend? Do these two steps again.', seconds: 6, screen: null, card: true,
  },
]

export const TECNO_VOICE: Record<string, string> = {
  intro: 'Do you have a TECNO, Infinix or itel phone? Then do these two quick settings once, so Xtend keeps working when your screen is off.',
  card: 'Before you can clock in, Xtend shows a card called: Auto-start and lock Xtend.',
  c1: 'Step one. Turn on Auto-start.',
  open: 'Tap Open Auto-start. Phone Master opens on its Auto-start list.',
  switch: 'Find Xtend in the list, and switch it on.',
  switched: 'Xtend is now on. If there is no button, open Phone Master yourself, then App management, or Auto-start.',
  c2: 'Step two. Lock Xtend in your recent apps.',
  recents: 'Open your recent apps. Tap the square button, or swipe up from the bottom of the screen and hold.',
  pull: 'Find the Xtend card, and pull it down until a lock shows on it.',
  locked: 'Now there is a lock on Xtend, and the phone will not close it by itself.',
  c3: 'Step three. Tell Xtend you are done.',
  confirm: 'Come back to Xtend and tap: I did both. Xtend remembers it on this phone.',
  ready: 'That is all. Now clock in at your store, as usual.',
  end: 'You are ready. If you change your phone, or reinstall Xtend, do these two steps again.',
}

const ICONS = [Power, Lock, CheckCircle2]

export const TECNO_SET: VideoSet = {
  scenes: TECNO_SCENES,
  voice: TECNO_VOICE,
  chapters: TECNO_CHAPTERS,
  icons: ICONS,
  tagline: 'Xtend · TECNO, Infinix and itel phones',
}
