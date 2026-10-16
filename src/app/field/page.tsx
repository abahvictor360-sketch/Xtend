import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldHome } from '@/components/field/field-home'
import { Alert } from '@/components/ui/alert'
import { CountDueBanner } from '@/components/field/count-due-banner'
import { getCountStatus } from '@/lib/store-count-status'
import { avatarUrls } from '@/lib/avatars'
import type { DayState } from '@/lib/types'
import type { VisitOutlet, VisitRow } from '@/components/field/store-visits'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clock — Xtend' }

export default async function FieldPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  // The day itself, today's store visits, and the stores allocated to
  // them for the picker (060: none when nothing is allocated yet).
  const [
    { data, error },
    { data: visits },
    { data: outlets },
    { data: canVisitStores },
    countStatus,
    photos,
  ] = await Promise.all([
    supabase.rpc('my_day'),
    supabase.rpc('my_store_visits'),
    supabase.rpc('my_visit_stores'),
    supabase.rpc('can_visit_stores'),
    getCountStatus(supabase),
    avatarUrls(supabase, [session.userId]),
  ])

  const photo = photos.get(session.userId) ?? null

  if (error || !data) {
    return <Alert variant="destructive">Could not load today. Pull down to retry.</Alert>
  }

  return (
    <>
      {countStatus.open && <CountDueBanner status={countStatus} />}
      <FieldHome
        day={data as DayState}
        visits={(visits ?? []) as VisitRow[]}
        outlets={(outlets ?? []) as VisitOutlet[]}
        canVisitStores={canVisitStores === true}
        notificationsRequired={!session.profile.push_exempt}
        avatarUrl={photo}
        userId={session.userId}
      />
    </>
  )
}
