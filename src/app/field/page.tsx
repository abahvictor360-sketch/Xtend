import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldHome } from '@/components/field/field-home'
import { Alert } from '@/components/ui/alert'
import type { DayState } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clock — Xtend' }

export default async function FieldPage() {
  await requireSession(['merchandiser', 'admin'])
  const supabase = await createServerSupabase()

  // One round trip: profile, outlet, today's two clock events, report state.
  const { data, error } = await supabase.rpc('my_day')

  if (error || !data) {
    return <Alert variant="destructive">Could not load today. Pull down to retry.</Alert>
  }

  return <FieldHome day={data as DayState} />
}
