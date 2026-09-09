import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldHome } from '@/components/field/field-home'
import { Alert } from '@/components/ui/alert'
import type { Coverage, DayState } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clock — Xtend' }

export default async function FieldPage() {
  await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  // Two round trips: the day itself, and how much of it the heartbeat saw.
  const [{ data, error }, { data: coverage }] = await Promise.all([
    supabase.rpc('my_day'),
    supabase.rpc('my_coverage'),
  ])

  if (error || !data) {
    return <Alert variant="destructive">Could not load today. Pull down to retry.</Alert>
  }

  return <FieldHome day={data as DayState} coverage={(coverage as Coverage) ?? null} />
}
