import Link from 'next/link'
import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { ArrowRight, BellRing, Download, Smartphone, WifiOff, Zap } from 'lucide-react'
import { XpelLockup, XpelTile } from '@/components/brand/logo'
import { cn } from '@/lib/utils'
import { isAppUserAgent } from '@/lib/app-agent'
import { publishedAndroidApk } from '@/lib/app-release'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Get the app — Xtend',
  description: 'Download Xtend for Android or iPhone.',
}

type Platform = 'android' | 'ios'

/**
 * Where staff get the Xtend app (mobile/). Public, no sign-in.
 *
 *   ANDROID_APK_URL  optional: the APK or a Play Store link. Without it,
 *                    the APK the mobile workflow publishes on GitHub
 *                    (src/lib/app-release.ts)
 *   IOS_APP_URL      the TestFlight invite or App Store link
 *   APP_VERSION      optional, shown under the buttons (the GitHub
 *                    release's version otherwise)
 *
 * A platform without a link shows "coming soon" and the browser version.
 */
export default async function DownloadPage() {
  const h = await headers()
  const ua = h.get('user-agent') ?? ''
  const device: Platform | 'desktop' = /android/i.test(ua)
    ? 'android'
    : /iphone|ipad|ipod/i.test(ua)
      ? 'ios'
      : 'desktop'

  // A link set in Vercel wins; otherwise the APK the mobile workflow
  // published on GitHub, if there is one yet.
  const published = process.env.ANDROID_APK_URL ? null : await publishedAndroidApk()
  const links: Record<Platform, string | null> = {
    android: process.env.ANDROID_APK_URL || published?.url || null,
    ios: process.env.IOS_APP_URL || null,
  }
  const version = process.env.APP_VERSION || published?.version || null
  const inApp = isAppUserAgent(ua)

  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'xtend-brown.vercel.app'
  const pageUrl = `https://${host}/download`
  const qr =
    device === 'desktop'
      ? await QRCode.toString(pageUrl, {
          type: 'svg',
          margin: 0,
          errorCorrectionLevel: 'M',
          color: { dark: '#2b211c', light: '#00000000' },
        })
      : null

  // The phone in hand comes first.
  const order: Platform[] = device === 'ios' ? ['ios', 'android'] : ['android', 'ios']

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="bg-brand px-6 pb-24 pt-14 text-white safe-top">
        <div className="mx-auto w-full max-w-3xl">
          <XpelTile />
          <h1 className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight sm:text-[40px]">
            Get the Xtend app
          </h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/85">
            Clock in, check in at your stores and send your counts from an app on your phone. Same
            account, same sign-in.
          </p>
        </div>
      </div>

      <div className="-mt-12 flex-1 rounded-t-[2rem] bg-background px-4 pb-12 pt-6 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          {inApp && (
            <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-tint-foreground">
              You are already using the Xtend app on this phone. Share this page with a colleague
              who needs it.
            </p>
          )}

          <section aria-label="Choose your phone" className="grid gap-4 sm:grid-cols-2">
            {order.map((p) => (
              <PlatformCard
                key={p}
                platform={p}
                href={links[p]}
                highlighted={device === p}
                version={version}
              />
            ))}
          </section>

          {qr && (
            <section className="surface flex flex-col items-center gap-5 p-6 sm:flex-row">
              <div
                className="h-36 w-36 shrink-0 rounded-2xl bg-white p-3 shadow-soft"
                aria-label="QR code for this page"
                role="img"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <div className="text-center sm:text-left">
                <h2 className="text-lg font-bold">On a computer?</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Point your phone&apos;s camera at the code to open this page on your phone, then
                  tap the download button for your phone.
                </p>
              </div>
            </section>
          )}

          <section aria-label="Why use the app" className="grid gap-3 sm:grid-cols-3">
            <Benefit icon={Zap} title="Straight to your day">
              Opens on your clock-in screen, no browser or web address to find.
            </Benefit>
            <Benefit icon={WifiOff} title="Weak signal is fine">
              What you do without network is kept and sent when you are back online.
            </Benefit>
            <Benefit icon={BellRing} title="Never miss a count">
              Notifications when a store count is due or your supervisor needs you.
            </Benefit>
          </section>

          <section className="flex flex-col items-center gap-3 pt-2 text-center">
            <Link
              href="/"
              className="text-balance text-sm font-semibold text-brand hover:underline"
            >
              Already installed, or prefer the browser? Open Xtend{' '}
              <ArrowRight className="inline h-4 w-4 align-[-3px]" />
            </Link>
            <p className="max-w-sm text-xs text-muted-foreground">
              Having trouble installing? Ask your supervisor or admin.
            </p>
            <XpelLockup width={120} className="mt-4 opacity-90" />
          </section>
        </div>
      </div>
    </main>
  )
}

const COPY: Record<
  Platform,
  { name: string; button: string; steps: string[]; note: string }
> = {
  android: {
    name: 'Android',
    button: 'Download for Android',
    steps: [
      'Tap the button. Your phone downloads the Xtend app file.',
      'Open the downloaded file. If asked, allow your browser to install apps.',
      'Tap Install, then open Xtend and sign in.',
    ],
    note: 'Android 7 or newer.',
  },
  ios: {
    name: 'iPhone',
    button: 'Get it for iPhone',
    steps: [
      'Tap the button. If asked, install TestFlight from the App Store first.',
      'Back on this page, tap the button again and choose Accept, then Install.',
      'Open Xtend and sign in.',
    ],
    note: 'iOS 15 or newer.',
  },
}

function PlatformCard({
  platform,
  href,
  highlighted,
  version,
}: {
  platform: Platform
  href: string | null
  highlighted: boolean
  version: string | null
}) {
  const copy = COPY[platform]
  return (
    <article
      className={cn(
        'surface flex flex-col p-5 sm:p-6',
        highlighted && 'ring-2 ring-brand ring-offset-2 ring-offset-background',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="icon-tile">
            <Smartphone className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold leading-tight">{copy.name}</h2>
            <p className="text-xs text-muted-foreground">{copy.note}</p>
          </div>
        </div>
        {highlighted && (
          <span className="rounded-full bg-tint px-2.5 py-1 text-[11px] font-bold text-tint-foreground">
            Your phone
          </span>
        )}
      </div>

      <ol className="mt-5 flex-1 space-y-3">
        {copy.steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm leading-snug">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6">
        {href ? (
          <a
            href={href}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-[15px] font-bold text-white shadow-lift transition-colors hover:bg-brand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            {...(platform === 'android' ? { download: true } : { target: '_blank', rel: 'noreferrer' })}
          >
            <Download className="h-5 w-5" />
            {copy.button}
          </a>
        ) : (
          <>
            <span
              aria-disabled="true"
              className="flex h-12 w-full cursor-not-allowed items-center justify-center rounded-2xl bg-muted px-5 text-[15px] font-bold text-muted-foreground"
            >
              Coming soon
            </span>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Until then, use Xtend in your phone&apos;s browser:{' '}
              <Link href="/" className="font-semibold text-brand hover:underline">
                open Xtend
              </Link>
              .
            </p>
          </>
        )}
        {href && version && (
          <p className="mt-2 text-center text-xs text-muted-foreground">Version {version}</p>
        )}
      </div>
    </article>
  )
}

function Benefit({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Zap
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="surface p-4">
      <Icon className="h-5 w-5 text-brand" />
      <h3 className="mt-3 text-sm font-bold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}
