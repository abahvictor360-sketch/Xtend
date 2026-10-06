'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Store,
} from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { ProfilePhoto } from '@/components/field/profile-photo'
import { usePush } from '@/components/field/use-push'
import { cn } from '@/lib/utils'

type Step = 'welcome' | 'photo' | 'location' | 'notifications' | 'clock'
const STEPS: Step[] = ['welcome', 'photo', 'location', 'notifications', 'clock']

/**
 * The first-run walkthrough for new staff: what a day in Xtend looks like,
 * a profile photo, location, notifications, and how to clock in. Finishing
 * it sets profiles.onboarded_at (036), so it shows once.
 */
export function Onboarding({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const router = useRouter()
  const push = usePush()
  const [index, setIndex] = useState(0)
  const [hasPhoto, setHasPhoto] = useState(Boolean(photoUrl))
  const [location, setLocation] = useState<'idle' | 'asking' | 'on' | 'blocked'>('idle')
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const step = STEPS[index]
  const first = name.split(/\s+/)[0] ?? name

  const canContinue = step !== 'photo' || hasPhoto

  function askLocation() {
    if (!('geolocation' in navigator)) return setLocation('blocked')
    setLocation('asking')
    navigator.geolocation.getCurrentPosition(
      () => setLocation('on'),
      (e) => setLocation(e.code === e.PERMISSION_DENIED ? 'blocked' : 'on'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  async function finish() {
    setFinishing(true)
    setError(null)
    const { error: rpc } = await supabase().rpc('finish_onboarding')
    if (rpc) {
      setFinishing(false)
      setError('That did not go through. Check your connection and try again.')
      return
    }
    router.replace('/field')
    router.refresh()
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 safe-top">
      {/* Progress: one bar per step. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          aria-label="Back"
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card transition-opacity',
            index === 0 && 'pointer-events-none opacity-0',
          )}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn('h-1.5 flex-1 rounded-full', i <= index ? 'bg-brand' : 'bg-border')}
            />
          ))}
        </div>
        <span className="w-11 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
          {index + 1}/{STEPS.length}
        </span>
      </div>

      <div key={step} className="flex flex-1 animate-fade-up flex-col pt-6">
        {step === 'welcome' && (
          <>
            <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-tight">
              Welcome,
              <br />
              <span className="text-brand">{first}!</span>
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Xtend is where your work day starts and ends. Here is how a day goes:
            </p>
            <ul className="mt-5 space-y-2.5">
              <Item icon={LogIn} title="Clock in" text="At your store, with a quick selfie." />
              <Item icon={Store} title="Work your store" text="Marketers check in at each store they visit." />
              <Item icon={ClipboardList} title="Report and count" text="A daily report or a store count when asked." />
              <Item icon={LogOut} title="Clock out" text="At the end of your shift, with a selfie." />
            </ul>
          </>
        )}

        {step === 'photo' && (
          <>
            <Title title="Add your photo" text="Your photo helps your team recognise you. Face the camera in good light." />
            <div className="surface mt-6 py-8">
              <ProfilePhoto name={name} url={photoUrl} size="lg" onSaved={() => setHasPhoto(true)} />
            </div>
            {!hasPhoto && (
              <p className="mt-3 text-center text-xs text-muted-foreground">Take your photo to continue.</p>
            )}
          </>
        )}

        {step === 'location' && (
          <>
            <Title
              title="Turn on location"
              text="Xtend uses your location to confirm you are at your store when you clock in."
            />
            <div className="surface mt-6 space-y-4 p-5 text-sm">
              <Line n={1} text="Tap the button below and choose Allow." />
              <Line n={2} text="In your phone's settings, set Location to High accuracy." />
              <StatusButton
                state={location === 'on' ? 'done' : location === 'asking' ? 'busy' : 'idle'}
                onClick={askLocation}
                icon={MapPin}
                idle="Allow location"
                done="Location is on"
              />
              {location === 'blocked' && (
                <p className="rounded-2xl bg-tint px-4 py-3 text-xs text-tint-foreground">
                  Location is blocked. Open your phone&apos;s Settings, then Apps, then Xtend or Chrome,
                  and allow Location. You can carry on and do this before you clock in.
                </p>
              )}
            </div>
          </>
        )}

        {step === 'notifications' && (
          <>
            <Title
              title="Turn on notifications"
              text="You need them to clock in. Xtend uses them for store counts and messages from the office."
            />
            <div className="surface mt-6 space-y-4 p-5 text-sm">
              <StatusButton
                state={push.state === 'on' ? 'done' : push.state === 'working' ? 'busy' : 'idle'}
                onClick={() => void push.enable()}
                icon={BellRing}
                idle="Turn on notifications"
                done="Notifications are on"
              />
              {push.state === 'denied' && (
                <p className="rounded-2xl bg-tint px-4 py-3 text-xs text-tint-foreground">
                  Notifications are blocked. Open your phone&apos;s Settings, find Xtend (or Chrome),
                  and allow Notifications. You can carry on and do this before you clock in.
                </p>
              )}
              {push.state === 'unsupported' && (
                <p className="rounded-2xl bg-tint px-4 py-3 text-xs text-tint-foreground">
                  This browser cannot receive notifications. Get the Xtend app from the download
                  page, or open Xtend in Chrome.
                </p>
              )}
              {push.error && <p className="text-xs text-destructive">{push.error}</p>}
            </div>
          </>
        )}

        {step === 'clock' && (
          <>
            <Title title="Clocking in" text="When you arrive at your store each day:" />
            <div className="surface mt-6 space-y-3 p-5 text-sm">
              <Line n={1} text="Open Xtend inside your store." />
              <Line n={2} text="Tap Clock in with selfie and take a clear photo of your face." />
              <Line n={3} text="Wait a moment while Xtend checks. That's it, you are on shift." />
              <Image
                src="/guide/staff-clock.png"
                alt="The Clock in with selfie button"
                width={780}
                height={160}
                className="mt-2 h-auto w-full rounded-2xl"
              />
            </div>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Need more help? The{' '}
              <Link href="/field/guide" className="font-semibold text-brand">
                full guide
              </Link>{' '}
              is always under You.
            </p>
          </>
        )}
      </div>

      {error && <p className="mb-3 text-center text-sm text-destructive">{error}</p>}

      {step === 'clock' ? (
        <button
          type="button"
          onClick={() => void finish()}
          disabled={finishing}
          className="flex h-16 w-full items-center rounded-full bg-brand p-2 text-primary-foreground transition-[filter] hover:brightness-105 disabled:opacity-80"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand">
            {finishing ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
          </span>
          <span className="flex-1 text-center text-base font-semibold italic">Start using Xtend</span>
          <span className="w-12" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          disabled={!canContinue}
          className="flex h-16 w-full items-center rounded-full bg-[hsl(24_14%_11%)] p-2 text-white transition-opacity disabled:opacity-40"
        >
          <span className="w-12" />
          <span className="flex-1 text-center text-base font-semibold">
            {step === 'welcome' ? "Let's set you up" : 'Continue'}
          </span>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-foreground">
            <ArrowRight className="h-5 w-5" />
          </span>
        </button>
      )}
    </div>
  )
}

function Title({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{text}</p>
    </>
  )
}

function Item({ icon: Icon, title, text }: { icon: typeof LogIn; title: string; text: string }) {
  return (
    <li className="flex items-center gap-3 rounded-full bg-card p-2 pr-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-tint text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </li>
  )
}

function Line({ n, text }: { n: number; text: string }) {
  return (
    <p className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
        {n}
      </span>
      <span className="pt-0.5">{text}</span>
    </p>
  )
}

function StatusButton({
  state,
  onClick,
  icon: Icon,
  idle,
  done,
}: {
  state: 'idle' | 'busy' | 'done'
  onClick: () => void
  icon: typeof LogIn
  idle: string
  done: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== 'idle'}
      className={cn(
        'flex h-14 w-full items-center gap-3 rounded-full p-1.5 pr-4 text-sm font-semibold transition-colors',
        state === 'done' ? 'bg-success/10 text-success' : 'bg-brand text-primary-foreground hover:brightness-105',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full bg-white',
          state === 'done' ? 'text-success' : 'text-brand',
        )}
      >
        {state === 'busy' ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : state === 'done' ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </span>
      {state === 'done' ? done : idle}
    </button>
  )
}
