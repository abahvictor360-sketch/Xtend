import Link from 'next/link'
import { Bell, BookOpen, Clock, Headset, KeyRound, MapPin, Smartphone } from 'lucide-react'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { BASE_LABEL } from '@/lib/staff-roles'
import { SheetScreen, HeaderField, SectionHeader } from '@/components/field/screen'
import { TaskRow } from '@/components/field/task-row'
import { SignOutButton } from '@/components/sign-out-button'
import { XpelLockup } from '@/components/brand/logo'
import { PushToggle } from '@/components/field/push-toggle'
import { formatLagos } from '@/lib/utils'
import { avatarUrls } from '@/lib/avatars'
import { ProfilePhoto } from '@/components/field/profile-photo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account — Xtend' }

export default async function AccountPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  const { data: inbox } = await supabase.rpc('my_notifications', { p_limit: 10 })
  // A role an admin added (042) shows by its own name.
  const { data: addedRole } = session.profile.staff_role_id
    ? await supabase
        .from('staff_roles')
        .select('name')
        .eq('id', session.profile.staff_role_id)
        .maybeSingle<{ name: string }>()
    : { data: null }
  const messages = (inbox ?? []) as {
    id: string
    title: string
    body: string
    sent_at: string
    sender_name: string | null
    read_at: string | null
  }[]

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

  const photo = (await avatarUrls(supabase, [session.userId])).get(session.userId) ?? null

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
            value={addedRole?.name ?? BASE_LABEL[session.profile.role]}
          />
        </>
      }
    >
      <div className="space-y-5">
        <section className="surface p-5">
          <ProfilePhoto name={session.profile.full_name} url={photo} />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Your photo helps your team recognise you. Take it facing the camera in good light.
          </p>
        </section>

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
          <SectionHeader title="Need help?" />
          <Link href="/field/support" className="block">
            <TaskRow
              icon={<Headset className="h-5 w-5" />}
              title="Message support"
              meta="Report a problem. The Xtend helper replies, and the office steps in when needed."
            />
          </Link>
          <Link href="/field/guide" className="block">
            <TaskRow
              icon={<BookOpen className="h-5 w-5" />}
              title="How to use Xtend"
              meta="Step-by-step help, from clocking in to the end of the day."
            />
          </Link>
        </section>

        <section className="space-y-3">
          <SectionHeader title="Messages from the office" />
          <PushToggle />
          {messages.length > 0 && (
            <div className="space-y-2">
              {messages.map((message) => (
                <TaskRow
                  key={message.id}
                  icon={<Bell className="h-5 w-5" />}
                  title={message.title}
                  meta={
                    <>
                      {message.body}
                      <span className="mt-0.5 block text-[11px]">
                        {message.sender_name ?? 'Office'} · {formatLagos(message.sent_at)}
                      </span>
                    </>
                  }
                  muted={Boolean(message.read_at)}
                />
              ))}
            </div>
          )}
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
        </section>

        <section className="space-y-3">
          <SectionHeader title="Tips" />
          <TaskRow
            icon={<Clock className="h-5 w-5" />}
            title="Keep location on during your shift"
            meta="In the Xtend app your shift is recorded even with the app closed, until you clock out. In a browser, keep Xtend open."
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
