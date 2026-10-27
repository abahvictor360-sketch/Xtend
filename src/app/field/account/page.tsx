import Link from 'next/link'
import { Bell, BookOpen, CalendarCheck, CalendarDays, Clock, Headset, KeyRound, MapPin, MessagesSquare, Smartphone } from 'lucide-react'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { BASE_LABEL } from '@/lib/staff-roles'
import { SheetScreen, HeaderField, SectionHeader } from '@/components/field/screen'
import { TaskRow } from '@/components/field/task-row'
import { SignOutButton } from '@/components/sign-out-button'
import { XpelLockup } from '@/components/brand/logo'
import { PushToggle } from '@/components/field/push-toggle'
import { formatLagos } from '@/lib/utils'
import { profileAvatarUrl } from '@/lib/avatars'
import { ProfilePhoto } from '@/components/field/profile-photo'
import { CountSheetPanel, type SentSheet } from '@/components/field/count-sheet-panel'
import { getCountStatus } from '@/lib/store-count-status'
import { countMonth } from '@/lib/count-sheet'
import { countSheetStatus } from '@/lib/report-files'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account — Xtend' }

export default async function AccountPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  const [{ data: inbox }, { data: addedRole }, { data: outlet }, photo, countStatus, { data: today }, { data: unread }] =
    await Promise.all([
    supabase.rpc('my_notifications', { p_limit: 10 }),
    // A role an admin added (042) shows by its own name.
    session.profile.staff_role_id
      ? supabase
          .from('staff_roles')
          .select('name')
          .eq('id', session.profile.staff_role_id)
          .maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
    session.profile.outlet_id
      ? supabase
          .from('outlets')
          .select('name, address, geofence_radius_m, shift_start, shift_end')
          .eq('id', session.profile.outlet_id)
          .maybeSingle<{
            name: string
            address: string | null
            geofence_radius_m: number
            shift_start: string
            shift_end: string
          }>()
      : Promise.resolve({ data: null }),
    profileAvatarUrl(supabase, session.profile.avatar_path),
    // Whether their role takes stock counts (046); a due count is not needed.
    getCountStatus(supabase),
    supabase.rpc('business_date'),
    // Unread messages from their supervisor (0073).
    supabase.rpc('unread_messages'),
  ])
  const unreadMessages = (unread as number | null) ?? 0
  const businessDate = (today as string | null) ?? ''

  // The stock count sheet, any time (0064): their stores, this month's
  // sheets, and whether there is a sheet to download.
  const sheet =
    countStatus.reason !== 'not_allowed' && businessDate
      ? await Promise.all([
          supabase.rpc('my_outlets'),
          supabase
            .from('store_count_sheet_detail')
            .select('id, outlet_name, file_name, created_at, request_id, count_was_due')
            .eq('user_id', session.userId)
            .gte('count_date', `${businessDate.slice(0, 7)}-01`)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('products')
            .select('id', { count: 'exact', head: true })
            .not('sheet_order', 'is', null)
            .eq('is_active', true),
          supabase.from('count_sheet_templates').select('id', { count: 'exact', head: true }),
        ])
      : null
  const sheetStores = ((sheet?.[0].data ?? []) as { id: string; name: string }[]).map((o) => ({
    id: o.id,
    name: o.name,
  }))
  const sentSheets: SentSheet[] = (
    (sheet?.[1].data ?? []) as (SentSheet & { request_id: string | null; count_was_due?: boolean | null })[]
  ).map((s) => ({
    id: s.id,
    outlet_name: s.outlet_name,
    file_name: s.file_name,
    created_at: s.created_at,
    status: `Sent ${formatLagos(s.created_at)} · ${countSheetStatus(s)}`,
  }))
  const messages = (inbox ?? []) as {
    id: string
    title: string
    body: string
    sent_at: string
    sender_name: string | null
    read_at: string | null
  }[]

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

        {sheet && sheetStores.length > 0 && (
          <section>
            <CountSheetPanel
              title="Stock count sheet"
              stores={sheetStores}
              sent={sentSheets}
              sentHeading="Sent this month"
              hasTemplate={(sheet[2].count ?? 0) > 0 || (sheet[3].count ?? 0) > 0}
              month={countMonth(businessDate)}
            />
          </section>
        )}

        <section className="space-y-3">
          <SectionHeader title="Days off and leave" />
          <Link href="/field/leave" className="block">
            <TaskRow
              icon={<CalendarDays className="h-5 w-5" />}
              title="Ask for leave"
              meta="Annual, sick or casual leave. See your requests and the answers."
              trailing={<span className="text-xs font-semibold text-brand">Open</span>}
            />
          </Link>
          <Link href="/field/history" className="block">
            <TaskRow
              icon={<CalendarCheck className="h-5 w-5" />}
              title="Your calendar"
              meta="Days you clocked in, days off, leave and missed days."
            />
          </Link>
        </section>

        <section className="space-y-3">
          <SectionHeader title="Need help?" />
          <Link href="/field/messages" className="block">
            <TaskRow
              icon={<MessagesSquare className="h-5 w-5" />}
              title="Messages"
              meta="Talk to your supervisor about your work."
              trailing={
                unreadMessages > 0 ? (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
                    {unreadMessages}
                  </span>
                ) : undefined
              }
            />
          </Link>
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
            title="Keep location and notifications on"
            meta="Xtend needs them to clock you in and out and to reach you."
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
