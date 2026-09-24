import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldHome } from '@/components/field/field-home'
import { Alert } from '@/components/ui/alert'
import { CountDueBanner } from '@/components/field/count-due-banner'
import { getCountStatus } from '@/lib/store-count-status'
import type { Coverage, DayState } from '@/lib/types'
import type { VisitOutlet, VisitRow } from '@/components/field/store-visits'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clock — Xtend' }

export default async function FieldPage() {
  await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  // The day itself, how much of it the heartbeat saw, today's store visits,
  // and every store Xtend knows, so the picker can name one without anybody
  // having had to allocate it first.
  const [
    { data, error },
    { data: coverage },
    { data: visits },
    { data: outlets },
    { data: canVisitStores },
    countStatus,
  ] = await Promise.all([
    supabase.rpc('my_day'),
    supabase.rpc('my_coverage'),
    supabase.rpc('my_store_visits'),
    supabase
      .from('outlets')
      .select('id, name, address, lat, lng, geofence_radius_m')
      .eq('is_active', true)
      .order('name'),
    supabase.rpc('can_visit_stores'),
    getCountStatus(supabase),
  ])

  if (error || !data) {
    return <Alert variant="destructive">Could not load today. Pull down to retry.</Alert>
  }

  return (
    <>
      {countStatus.open && <CountDueBanner status={countStatus} />}
      <FieldHome
        day={data as DayState}
        coverage={(coverage as Coverage) ?? null}
        visits={(visits ?? []) as VisitRow[]}
        outlets={(outlets ?? []) as VisitOutlet[]}
        canVisitStores={canVisitStores === true}
      />
    </>
  )
}
