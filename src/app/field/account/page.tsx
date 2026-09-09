import Link from 'next/link'
import { KeyRound, MapPin, Radio, ShieldCheck, Smartphone } from 'lucide-react'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen, HeaderField, SectionHeader } from '@/components/field/screen'
import { TaskRow } from '@/components/field/task-row'
import { SignOutButton } from '@/components/sign-out-button'
import { XpelLockup } from '@/components/brand/logo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account — Xtend' }

export default async function AccountPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  const { data: outlet } = await supabase
    .from('outlets')
    .select('name, address, geofence_radius_m, shift_start, shift_end')
    .eq('id', session.profile.outlet_id ?? '')
    .maybeSingle<{
      name: string
      address: string | null
      geofence_radius_m: number
      shift_start: string
      shift_end: string
    }>()

  return (
    <SheetScreen
      title="Your account"
      back="/field"
      header={
        <>
          <HeaderField label="Name" value={session.profile.full_name} />
          <HeaderField label="Signed in as" value={session.profile.email ?? session.email ?? '—'} />
          <HeaderField
            label="Role"
            value={session.profile.role === 'merchandiser' ? 'Merchandiser' : session.profile.role}
          />
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <SectionHeader title="Your posting" />
          <TaskRow
            icon={<MapPin className="h-5 w-5" />}
            title={outlet?.name ?? 'No outlet assigned'}
            meta={
              outlet
                ? `${outlet.address ?? 'No address'} · ${outlet.geofence_radius_m} m geofence · ${outlet.shift_start.slice(0, 5)}–${outlet.shift_end.slice(0, 5)}`
                : 'Ask your admin to assign your outlet.'
            }
            muted={!outlet}
          />
        </section>

        <section className="space-y-3">
          <SectionHeader title="Security" />
          <Link href="/change-password" className="block">
            <TaskRow
              icon={<KeyRound className="h-5 w-5" />}
              title="Change your password"
              meta="Pick something only you know."
              trailing={<span className="text-xs font-semibold text-brand">Change</span>}
            />
          </Link>
          <TaskRow
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Your attendance is append-only"
            meta="Nobody can edit or delete a record once it is saved. Not you, not an admin."
          />
        </section>

        <section className="space-y-3">
          <SectionHeader title="How Xtend tracks you" />
          <TaskRow
            icon={<Radio className="h-5 w-5" />}
            title="Location checks every 5 minutes"
            meta="While you are on shift, Xtend records where you are every 5 minutes and how far that is from your outlet. Going more than 300 m from where you clocked in notifies your admin."
          />
          <TaskRow
            icon={<Smartphone className="h-5 w-5" />}
            title="Install Xtend to your home screen"
            meta="Chrome menu → Add to Home screen. It opens full screen and loads faster on a weak network."
          />
        </section>

        <SignOutButton className="w-full" />

        <div className="flex flex-col items-center gap-2 pb-2">
          <XpelLockup width={120} className="opacity-80" />
          <p className="text-center text-[11px] text-muted-foreground">
            Xtend · field attendance
          </p>
        </div>
      </div>
    </SheetScreen>
  )
}
