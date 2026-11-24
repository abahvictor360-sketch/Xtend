import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import type { StartStore } from '@/components/field/start-store-sheet'
import { FieldHome } from '@/components/field/field-home'
import { DashboardRetry } from '@/components/field/dashboard-retry'
import { CountDueBanner } from '@/components/field/count-due-banner'
import { MessagesBanner } from '@/components/field/messages-banner'
import { getCountStatus } from '@/lib/store-count-status'
import { profileAvatarUrl } from '@/lib/avatars'
import type { DayState } from '@/lib/types'
import type { VisitOutlet, VisitRow } from '@/components/field/store-visits'
import type { CalendarDay } from '@/lib/schedule'
import { addDays, lagosDateString } from '@/lib/utils'
import { getActingRole } from '@/lib/acting'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clock — Xtend' }

export default async function FieldPage() {
  const session = await requireSession(FIELD_ROLES)
  // An admin viewing as a merchandiser sees no store visits or report; as a
  // marketer, both. Real field staff are unaffected (acting is null for them).
  const acting = await getActingRole(session)
  const supabase = await createServerSupabase()

  // The day itself, today's store visits, and the stores allocated to
  // them for the picker (060: none when nothing is allocated yet).
  const [
    { data, error },
    { data: visits },
    { data: outlets },
    { data: canVisitStores },
    countStatus,
    photo,
    { data: calendar },
    { data: unread },
    { data: openVisits },
    { data: myStores },
  ] = await Promise.all([
    supabase.rpc('my_day'),
    supabase.rpc('my_store_visits'),
    supabase.rpc('my_visit_stores'),
    supabase.rpc('can_visit_stores'),
    getCountStatus(supabase),
    profileAvatarUrl(supabase, session.profile.avatar_path),
    // The week row: worked, missed, day off or leave (migration 059).
    supabase.rpc('my_calendar', { p_from: addDays(lagosDateString(), -6), p_to: lagosDateString() }),
    // Unread messages from their supervisor (0073).
    supabase.rpc('unread_messages'),
    // An open store visit from any day (0086), so Check out always shows.
    // Missing function (0086 not run): nothing extra.
    supabase.rpc('my_open_store_visits'),
    // Their own stores (home and allocated): a marketer starts the day at one (0101).
    supabase.rpc('my_outlets'),
  ])

  if (error || !data) {
    return <DashboardRetry />
  }

  // Today's visits plus a visit still open from before, if any.
  const todayVisits = (visits ?? []) as VisitRow[]
  const allVisits = [
    ...todayVisits,
    ...((openVisits ?? []) as VisitRow[]).filter((v) => !todayVisits.some((t) => t.id === v.id)),
  ]

  // When an admin is acting, the role decides the experience; otherwise the
  // database's own answer stands.
  const showStores = acting ? acting === 'marketer' : canVisitStores === true
  const canFileReport = acting ? acting === 'marketer' : undefined
  // Marketers pick the store they start at before clocking in (0101).
  const isMarketer = acting ? acting === 'marketer' : session.profile.role === 'marketer'
  const startStores = isMarketer
    ? ((myStores ?? []) as (StartStore & { is_active: boolean })[])
        .filter((o) => o.is_active)
        .map(({ id, name, address, lat, lng, geofence_radius_m }) => ({ id, name, address, lat, lng, geofence_radius_m }))
    : null

  return (
    <>
      {((unread as number | null) ?? 0) > 0 && <MessagesBanner unread={unread as number} />}
      {countStatus.open && <CountDueBanner status={countStatus} />}
      <FieldHome
        day={data as DayState}
        visits={allVisits}
        outlets={(outlets ?? []) as VisitOutlet[]}
        canVisitStores={showStores}
        startStores={startStores}
        canFileReport={canFileReport}
        notificationsRequired={!session.profile.push_exempt}
        avatarUrl={photo}
        userId={session.userId}
        calendar={(calendar ?? []) as CalendarDay[]}
      />
    </>
  )
}
