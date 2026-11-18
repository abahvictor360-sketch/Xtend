'use client'

/* eslint-disable @next/next/no-img-element */
import { useLayoutEffect, useRef, useState } from 'react'
import {
  BatteryCharging,
  BellRing,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  Footprints,
  LifeBuoy,
  LogIn,
  LogOut,
  MapPin,
  Phone,
  ShieldCheck,
  Smartphone,
  Store,
  UserRound,
  Wifi,
} from 'lucide-react'
import { BackgroundGate } from '@/components/field/background-gate'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { XpelMark } from '@/components/brand/logo'
import { cn } from '@/lib/utils'

/**
 * The staff video guide (public/guide/xtend-staff-guide.mp4), scene by
 * scene. scripts/make-staff-video.ts photographs each scene at 1080×1920
 * and joins them. Screens use the app's own parts and words; phone system
 * screens are plain drawings (every phone looks a little different).
 * Like the written guide, it says what to switch on, never why.
 */

export interface Scene {
  id: string
  chapter: string
  /** The big caption. */
  title: string
  /** A line under it. */
  sub?: string
  /** Seconds on screen. */
  seconds: number
  screen: React.ReactNode
  /** The words on what a finger taps: a circle is drawn on it. */
  tap?: string
  /** A full-frame card with no phone (title, chapter and end cards). */
  card?: boolean
}

/* ---------------------------------------------------------------- */
/* Pieces of screen                                                  */
/* ---------------------------------------------------------------- */

function AppBar({ title = 'Xtend' }: { title?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
      <span className="brand-surface flex h-8 w-8 items-center justify-center rounded-lg">
        <XpelMark className="h-3.5 w-3.5" tone="light" />
      </span>
      <span className="text-base font-extrabold">{title}</span>
    </div>
  )
}

/** A plain phone system pop-up (Android-like, no brand). */
function SystemDialog({ icon: Icon, question, options, pick }: { icon: typeof MapPin; question: string; options: string[]; pick: number }) {
  return (
    <div className="flex h-full flex-col justify-end bg-black/45 p-4 pb-10">
      <div className="rounded-[28px] bg-[#f3f1f6] p-5 text-center text-[#1d1b20]">
        <Icon className="mx-auto h-7 w-7 text-[#3f5f90]" />
        <p className="mt-3 text-[17px] leading-snug">{question}</p>
        <div className="mt-4 space-y-2">
          {options.map((o, i) => (
            <div
              key={o}
              className={cn(
                'rounded-full px-4 py-3 text-[15px] font-medium',
                i === pick ? 'bg-[#3f5f90] text-white' : 'bg-[#e6e1ea] text-[#3f5f90]',
              )}
            >
              {o}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** A plain phone settings list with one choice to make. */
function SettingsList({ heading, path, options, pick, note }: { heading: string; path: string; options: string[]; pick: number; note?: string }) {
  return (
    <div className="h-full bg-[#fbf8fd] text-[#1d1b20]">
      <div className="px-5 pb-3 pt-6">
        <p className="text-xs text-[#5f5b66]">{path}</p>
        <p className="mt-1 text-2xl">{heading}</p>
      </div>
      <div className="space-y-1 px-3">
        {options.map((o, i) => (
          <div key={o} className={cn('flex items-center gap-4 rounded-2xl px-3 py-4', i === pick && 'bg-[#e3e8f5]')}>
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border-2',
                i === pick ? 'border-[#3f5f90]' : 'border-[#79747e]',
              )}
            >
              {i === pick && <span className="h-2.5 w-2.5 rounded-full bg-[#3f5f90]" />}
            </span>
            <span className="text-[16px]">{o}</span>
          </div>
        ))}
      </div>
      {note && <p className="px-6 pt-4 text-sm text-[#5f5b66]">{note}</p>}
    </div>
  )
}

/** The real clock button's look (clock-panel.tsx). */
function ClockButton({ out = false }: { out?: boolean }) {
  return (
    <div className="relative flex h-16 w-full items-center rounded-full bg-brand p-2 text-primary-foreground">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand">
        {out ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
      </span>
      <span className="flex-1 text-center text-base font-semibold italic">{out ? 'Clock out with selfie' : 'Clock in with selfie'}</span>
      <span aria-hidden className="w-12 shrink-0 text-center text-lg tracking-[-0.2em] text-white/70">
        ›››
      </span>
    </div>
  )
}

function HomeTop({ status }: { status: string }) {
  return (
    <div className="space-y-3 p-4">
      <div>
        <p className="text-sm text-muted-foreground">Good morning</p>
        <p className="text-2xl font-extrabold">Your name</p>
      </div>
      <div className="rounded-2xl bg-tint p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">Your next step</p>
        <p className="mt-1 text-base font-semibold">{status}</p>
      </div>
    </div>
  )
}

function Shot({ src, top = 0 }: { src: string; top?: number }) {
  return <img src={src} alt="" className="w-full" style={{ marginTop: -top }} />
}

function Gate({ always, battery }: { always: boolean; battery: boolean }) {
  return (
    <div className="space-y-4 p-4">
      <HomeTop status="Clock in at your store" />
      <BackgroundGate
        state={{ platform: 'android', always: !always, batteryUnrestricted: !battery }}
        needs={{ always, battery, blocked: always || battery }}
        action="clock in"
        onDone={() => {}}
      />
    </div>
  )
}

function Camera1() {
  return (
    <div className="relative flex h-full flex-col items-center justify-between bg-neutral-900 pb-8 pt-10 text-white">
      <p className="rounded-full bg-black/50 px-4 py-1.5 text-sm">Face the camera in good light</p>
      <div className="flex h-[280px] w-[215px] items-center justify-center rounded-[50%] border-4 border-white/80">
        <UserRound className="h-32 w-32 text-white/35" strokeWidth={1.2} />
      </div>
      <div data-tap="__shutter" className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white">
        <span className="h-16 w-16 rounded-full bg-white" />
      </div>
    </div>
  )
}

function Done({ title, line }: { title: string; line: string }) {
  return (
    <div className="space-y-4 p-4">
      <HomeTop status={line} />
      <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-4">
        <CheckCircle2 className="h-6 w-6 text-success" />
        <div>
          <p className="font-bold">{title}</p>
          <p className="text-sm text-muted-foreground">{line}</p>
        </div>
      </div>
    </div>
  )
}

function Big({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-card p-8 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-tint text-brand">
        <Icon className="h-10 w-10" />
      </span>
      <div className="text-lg font-semibold leading-snug">{children}</div>
    </div>
  )
}

function VisitCard({ checkedIn }: { checkedIn: boolean }) {
  return (
    <div className="space-y-4 p-4">
      <HomeTop status={checkedIn ? 'Checked in at Your Store' : 'Check in at the store you are in'} />
      <Card>
        <CardContent className="space-y-3 pt-5">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Store className="h-4 w-4 text-brand" /> {checkedIn ? 'At Your Store since 10:02' : 'You are at Your Store'}
          </p>
          <Button size="xl" className="w-full" variant={checkedIn ? 'outline' : 'default'}>
            {checkedIn ? 'Check out of Your Store' : 'Check in here'}
          </Button>
          {!checkedIn && <p className="text-center text-sm font-semibold text-brand">Pick the store myself</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function Problem({ q, steps }: { q: string; steps: string[] }) {
  return (
    <div className="h-full space-y-5 bg-card p-6">
      <p className="text-xl font-bold">{q}</p>
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-[18px] leading-snug">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-brand">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* The video, in order                                               */
/* ---------------------------------------------------------------- */

export const CHAPTERS = [
  'Get the app',
  'Sign in',
  'Allow location, camera and notifications',
  'Finish setting up: location and battery',
  'Your photo',
  'Clock in',
  'Store visits (marketers)',
  'Daily report',
  'Clock out',
  'When something goes wrong',
] as const

const C = CHAPTERS

export const SCENES: Scene[] = [
  { id: 'intro', chapter: '', title: 'How to use Xtend', sub: 'Step by step: set up your phone, clock in, visit stores and clock out.', seconds: 5, screen: null, card: true },

  // 1 Get the app
  { id: 'c1', chapter: C[0], title: C[0], sub: 'Step 1', seconds: 3, screen: null, card: true },
  {
    id: 'download', chapter: C[0], title: 'Open the download page', sub: 'Your supervisor sends you the link. Tap “Download for Android”.', seconds: 6,
    screen: <Shot src="/guide/staff-download.png" />,
  },
  {
    id: 'install', chapter: C[0], title: 'Open the file and tap Install', sub: 'If the phone asks, allow installing from this source.', seconds: 6,
    screen: <SystemDialog icon={Download} question="Do you want to install this app? Xtend" options={['Install', 'Cancel']} pick={0} />,
    tap: 'Install',
  },
  {
    id: 'invalid', chapter: C[0], title: '“App not installed”?', sub: 'Uninstall the old Xtend first (hold its icon, then Uninstall), then install again.', seconds: 6,
    screen: <Big icon={Smartphone}>Hold the old Xtend icon → <b>Uninstall</b>, then open the new file again.</Big>,
  },

  // 2 Sign in
  { id: 'c2', chapter: C[1], title: C[1], sub: 'Step 2', seconds: 3, screen: null, card: true },
  {
    id: 'login', chapter: C[1], title: 'Sign in', sub: 'Use the email or phone number your admin registered, and the password you were given.', seconds: 7,
    screen: <Shot src="/guide/staff-login.png" />,
  },
  {
    id: 'password', chapter: C[1], title: 'Choose your own password', sub: 'The first time, pick a new password only you know.', seconds: 5,
    screen: <Big icon={ShieldCheck}>Type a new password twice, then tap <b>Save</b>.</Big>,
  },

  // 3 Permissions
  { id: 'c3', chapter: C[2], title: C[2], sub: 'Step 3 · once per phone', seconds: 3, screen: null, card: true },
  {
    id: 'perm-location', chapter: C[2], title: 'Location: tap Allow', sub: 'Choose “While using the app” for now. Xtend asks for “all the time” next.', seconds: 6,
    screen: <SystemDialog icon={MapPin} question="Allow Xtend to access this device’s location?" options={['While using the app', 'Only this time', 'Don’t allow']} pick={0} />,
    tap: 'While using the app',
  },
  {
    id: 'perm-camera', chapter: C[2], title: 'Camera: tap Allow', sub: 'Clocking in and out takes a selfie inside Xtend.', seconds: 5,
    screen: <SystemDialog icon={Camera} question="Allow Xtend to take pictures and record video?" options={['While using the app', 'Only this time', 'Don’t allow']} pick={0} />,
    tap: 'While using the app',
  },
  {
    id: 'notif-gate', chapter: C[2], title: 'Turn on notifications', sub: 'On Home, tap “Turn on notifications”. You cannot clock in until they are on.', seconds: 6,
    screen: (
      <div className="space-y-4 p-4">
        <HomeTop status="Turn on notifications" />
        <Card className="border-brand/40">
          <CardContent className="space-y-3 pt-5 text-sm">
            <p className="flex items-center gap-2 font-bold">
              <BellRing className="h-5 w-5 text-brand" /> Turn on notifications to clock in
            </p>
            <p className="text-muted-foreground">
              Xtend needs to reach you during your shift, so clocking in needs notifications turned on for Xtend on this phone.
            </p>
            <Button size="xl" className="w-full">
              <BellRing className="h-5 w-5" /> Turn on notifications
            </Button>
          </CardContent>
        </Card>
      </div>
    ),
    tap: 'Turn on notifications',
  },
  {
    id: 'perm-notif', chapter: C[2], title: 'Then tap Allow', sub: 'The phone asks once.', seconds: 4,
    screen: <SystemDialog icon={BellRing} question="Allow Xtend to send you notifications?" options={['Allow', 'Don’t allow']} pick={0} />,
    tap: 'Allow',
  },

  // 4 Location all the time + battery
  { id: 'c4', chapter: C[3], title: C[3], sub: 'Step 4 · Xtend shows this before your first clock-in', seconds: 4, screen: null, card: true },
  {
    id: 'gate-both', chapter: C[3], title: '“Finish setting up Xtend”', sub: 'Two settings to change. Start with location: tap “Open location settings”.', seconds: 7,
    screen: <Gate always battery />, tap: 'Open location settings',
  },
  {
    id: 'set-location', chapter: C[3], title: 'Choose “Allow all the time”', sub: 'Permissions → Location → Allow all the time. Then go back to Xtend.', seconds: 7,
    screen: <SettingsList path="Settings › Apps › Xtend › Permissions" heading="Location permission" options={['Allow all the time', 'Allow only while using the app', 'Ask every time', 'Don’t allow']} pick={0} note="Also keep “Use precise location” switched on." />,
    tap: 'Allow all the time',
  },
  {
    id: 'gate-battery', chapter: C[3], title: 'Location is done ✓', sub: 'Now battery: tap “Open battery settings”.', seconds: 6,
    screen: <Gate always={false} battery />, tap: 'Open battery settings',
  },
  {
    id: 'set-battery', chapter: C[3], title: 'Choose “Unrestricted”', sub: 'Find Xtend and choose “Unrestricted” (or “Don’t optimise”). Then go back to Xtend.', seconds: 7,
    screen: <SettingsList path="Settings › Apps › Xtend › Battery" heading="App battery usage" options={['Unrestricted', 'Optimised', 'Restricted']} pick={0} />,
    tap: 'Unrestricted',
  },
  {
    id: 'tecno', chapter: C[3], title: 'TECNO, Infinix or Xiaomi phone?', sub: 'Also switch on Auto-start for Xtend, and set its battery use to “No restrictions”.', seconds: 7,
    screen: <SettingsList path="Phone Master / Security › Auto-start" heading="Auto-start" options={['Xtend: on', 'Battery saver: No restrictions']} pick={0} />,
  },
  {
    id: 'gate-done', chapter: C[3], title: 'All set', sub: 'The setup card goes away by itself and the clock button appears.', seconds: 5,
    screen: (
      <div className="space-y-4 p-4">
        <HomeTop status="Clock in at your store" />
        <ClockButton />
        <p className="text-xs text-muted-foreground">You do not have to choose a store.</p>
      </div>
    ),
  },

  // 5 Photo
  { id: 'c5', chapter: C[4], title: C[4], sub: 'Step 5 · once', seconds: 3, screen: null, card: true },
  {
    id: 'photo', chapter: C[4], title: 'Add your profile photo', sub: 'Go to You → Take your photo. Face the camera in good light.', seconds: 6,
    screen: <Shot src="/guide/staff-photo.png" />,
  },

  // 6 Clock in
  { id: 'c6', chapter: C[5], title: C[5], sub: 'Step 6 · every working day, at your store', seconds: 3, screen: null, card: true },
  {
    id: 'home', chapter: C[5], title: 'Open Xtend inside your store', sub: 'Home shows your shift, your week and your next step.', seconds: 6,
    screen: <Shot src="/guide/staff-home.png" />,
  },
  {
    id: 'clock-in', chapter: C[5], title: 'Tap “Clock in with selfie”', sub: 'You do not have to choose a store.', seconds: 5,
    screen: (
      <div className="space-y-4 p-4">
        <HomeTop status="Clock in at your store" />
        <ClockButton />
      </div>
    ),
    tap: 'Clock in with selfie',
  },
  {
    id: 'selfie', chapter: C[5], title: 'Take a clear selfie', sub: 'Your face only, in good light. Hold still and tap the round button.', seconds: 6,
    screen: <Camera1 />, tap: '__shutter',
  },
  {
    id: 'clocked-in', chapter: C[5], title: 'Wait for “Clocked in”', sub: 'Xtend checks your location and the photo. Then you are on shift.', seconds: 6,
    screen: <Done title="Clocked in · on site" line="Have a good shift" />,
  },

  // 7 Store visits
  { id: 'c7', chapter: C[6], title: C[6], sub: 'Step 7 · marketers only', seconds: 3, screen: null, card: true },
  {
    id: 'check-in', chapter: C[6], title: 'At each store: “Check in here”', sub: 'Not found? Tap “Pick the store myself”. Clock in first.', seconds: 7,
    screen: <VisitCard checkedIn={false} />, tap: 'Check in here',
  },
  {
    id: 'check-out', chapter: C[6], title: 'Leaving: “Check out”', sub: 'Take a selfie, as at check-in, before you go to the next store. One store at a time.', seconds: 7,
    screen: <VisitCard checkedIn />, tap: 'Check out of Your Store',
  },

  // 8 Report
  { id: 'c8', chapter: C[7], title: C[7], sub: 'Step 8 · if you have a Report tab', seconds: 3, screen: null, card: true },
  {
    id: 'report', chapter: C[7], title: 'Tap Report, fill it in, Submit', sub: 'Choose the whole day or one store. Attach documents if you have them. You can edit until midnight.', seconds: 8,
    screen: <Big icon={FileText}>Report → <b>The whole day</b> or a store → write how it went → <b>Submit report</b></Big>,
  },

  // 9 Clock out
  { id: 'c9', chapter: C[8], title: C[8], sub: 'Step 9 · at the end of your shift', seconds: 3, screen: null, card: true },
  {
    id: 'clock-out', chapter: C[8], title: 'Tap “Clock out with selfie”', sub: 'Marketers: check out of your last store first. Xtend reminds you when your shift ends.', seconds: 7,
    screen: (
      <div className="space-y-4 p-4">
        <HomeTop status="Clock out when your shift ends" />
        <ClockButton out />
      </div>
    ),
    tap: 'Clock out with selfie',
  },
  {
    id: 'progress', chapter: C[8], title: 'Your day is done', sub: 'One clock-in and one clock-out per day. Each ring closes when that step is done.', seconds: 6,
    screen: <Shot src="/guide/staff-progress.png" />,
  },

  // 10 Problems
  { id: 'c10', chapter: C[9], title: C[9], sub: 'Step 10', seconds: 3, screen: null, card: true },
  {
    id: 'p-location', chapter: C[9], title: '“Location is blocked” or not accurate', seconds: 8,
    screen: <Problem q="Location problems" steps={['Settings → Apps → Xtend → Permissions → Location → Allow all the time.', 'Turn location on, with precise / high accuracy.', 'Step outside or near a window for a moment, then tap Try again.']} />,
  },
  {
    id: 'p-offsite', chapter: C[9], title: '“Off site”, but you are in your store?', seconds: 7,
    screen: <Problem q="Off site" steps={['Try again near the entrance or a window.', 'Still wrong? You → Message support, and say which store.']} />,
  },
  {
    id: 'p-network', chapter: C[9], title: 'No network?', seconds: 6,
    screen: <Big icon={Wifi}>Your clock-in waits on your phone and sends itself when you have signal. <b>Do not sign out</b> until it has gone.</Big>,
  },
  {
    id: 'p-call', chapter: C[9], title: 'The app will not clock you in?', sub: 'Call your supervisor. They can clock you in or out for you.', seconds: 6,
    screen: <Big icon={Phone}>Call your supervisor. You get a notification when they fix it.</Big>,
  },
  {
    id: 'p-help', chapter: C[9], title: 'Anything else: Message support', sub: 'Go to You → Message support. Say what happened, where and when.', seconds: 6,
    screen: <Big icon={LifeBuoy}>You → <b>Message support</b>. The reply comes as a notification.</Big>,
  },

  { id: 'end', chapter: '', title: 'You are ready', sub: 'Open Xtend at your store, clock in with a selfie, and clock out at the end of your shift.', seconds: 6, screen: null, card: true },
]

/* ---------------------------------------------------------------- */
/* One frame                                                         */
/* ---------------------------------------------------------------- */

const ICONS = [Download, LogIn, MapPin, BatteryCharging, Camera, LogIn, Store, FileText, LogOut, Footprints]

/** One scene at 540×960 CSS pixels (1080×1920 at 2×). */
export function SceneFrame({ scene }: { scene: Scene }) {
  const chapterNo = CHAPTERS.indexOf(scene.chapter as (typeof CHAPTERS)[number])
  if (scene.card) {
    const Icon = chapterNo >= 0 ? ICONS[chapterNo] : null
    return (
      <div className="brand-surface flex h-[960px] w-[540px] flex-col rounded-none items-center justify-center gap-6 px-12 text-center text-white">
        {Icon ? (
          <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/15">
            <Icon className="h-12 w-12" />
          </span>
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/15">
            <XpelMark className="h-12 w-12" tone="light" />
          </span>
        )}
        {scene.sub && chapterNo >= 0 && <p className="text-xl font-bold uppercase tracking-[0.18em] text-white/80">{scene.sub}</p>}
        <p className="text-[44px] font-extrabold leading-tight">{scene.title}</p>
        {scene.sub && chapterNo < 0 && <p className="text-2xl leading-snug text-white/90">{scene.sub}</p>}
        {scene.id === 'intro' && <p className="mt-6 text-lg text-white/75">Xtend · staff guide</p>}
      </div>
    )
  }
  return <PhoneScene scene={scene} chapterNo={chapterNo} />
}

/** The screen is 390×640 CSS pixels, shown 1.15× in a phone frame. */
const SCREEN_H = 640
const SCALE = 1.15

function PhoneScene({ scene, chapterNo }: { scene: Scene; chapterNo: number }) {
  const screenRef = useRef<HTMLDivElement>(null)
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null)
  // The circle goes on the element whose words are the tap label (or which
  // carries data-tap): the innermost match, measured once it has drawn.
  useLayoutEffect(() => {
    const root = screenRef.current
    if (!root || !scene.tap) return
    const find = () => {
      const marked = root.querySelector<HTMLElement>(`[data-tap="${scene.tap}"]`)
      const all = marked
        ? [marked]
        : [...root.querySelectorAll<HTMLElement>('button, a, div, span, p')].filter((el) => el.textContent?.trim() === scene.tap)
      const el = all[all.length - 1]
      if (!el) return
      const r = el.getBoundingClientRect()
      const box = root.getBoundingClientRect()
      setTap({ x: (r.left + r.width / 2 - box.left) / SCALE, y: (r.top + r.height / 2 - box.top) / SCALE })
    }
    find()
    const t = window.setTimeout(find, 400)
    return () => window.clearTimeout(t)
  }, [scene.tap])

  return (
    <div className="flex h-[960px] w-[540px] flex-col bg-canvas">
      <div className="space-y-2 px-7 pb-4 pt-8">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-brand">
          {chapterNo + 1}. {scene.chapter}
        </p>
        <p className="text-[32px] font-extrabold leading-[1.12]">{scene.title}</p>
        {scene.sub && <p className="text-[19px] leading-snug text-muted-foreground">{scene.sub}</p>}
      </div>
      <div className="flex flex-1 items-start justify-center overflow-hidden">
        <div
          className="relative overflow-hidden rounded-[40px] border-[8px] border-neutral-900 bg-background shadow-2xl"
          style={{ width: 390 * SCALE + 16, height: SCREEN_H * SCALE + 16 }}
        >
          <div
            ref={screenRef}
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: 390, height: SCREEN_H, transform: `scale(${SCALE})` }}
          >
            <div className="w-[390px] overflow-hidden bg-background" style={{ height: SCREEN_H }}>
              {scene.screen}
            </div>
            {tap && (
              <span
                className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-brand bg-brand/25"
                style={{ left: tap.x, top: tap.y, boxShadow: '0 0 0 10px rgba(209,81,26,0.18)' }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The scene page's body: one scene, or the list of scenes for the script. */
export function SceneView({ id, list }: { id: string | null; list: boolean }) {
  if (list) {
    return <pre id="list">{JSON.stringify(SCENES.map((x) => ({ id: x.id, seconds: x.seconds, chapter: x.card ? x.chapter : '' })))}</pre>
  }
  const scene = SCENES.find((x) => x.id === id) ?? SCENES[0]
  return (
    <div id="scene" className="w-[540px]">
      <SceneFrame scene={scene} />
    </div>
  )
}
