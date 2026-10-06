import Link from 'next/link'
import { ArrowRight, MapPin } from 'lucide-react'
import { XpelLockup, XpelTile } from '@/components/brand/logo'
import { StaffGuide } from '@/components/staff-guide'

export const metadata = {
  title: 'How to use Xtend',
  description: 'A step-by-step guide to Xtend for merchandisers and marketers.',
}

/** The staff guide: public, so it can be shared before anyone signs in. */
export default function GuidePage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="bg-brand px-6 pb-24 pt-14 text-white safe-top">
        <div className="mx-auto w-full max-w-3xl">
          <XpelTile />
          <h1 className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight sm:text-[40px]">
            How to use Xtend
          </h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/85">
            Everything a merchandiser or marketer needs, from the first sign-in to the end of the
            day.
          </p>
        </div>
      </div>

      <div className="-mt-12 flex-1 rounded-t-[2rem] bg-background px-4 pb-12 pt-6 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <StaffGuide />

          <section className="flex flex-col items-center gap-3 pt-2 text-center">
            <Link
              href="/"
              className="text-balance text-sm font-semibold text-brand hover:underline"
            >
              Open Xtend <ArrowRight className="inline h-4 w-4 align-[-3px]" />
            </Link>
            <p className="max-w-sm text-xs text-muted-foreground">
              <MapPin className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              Still stuck? Ask your supervisor or admin.
            </p>
            <XpelLockup width={120} className="mt-4 opacity-90" />
          </section>
        </div>
      </div>
    </main>
  )
}
