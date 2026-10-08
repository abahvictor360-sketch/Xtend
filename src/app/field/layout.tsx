import { redirect } from 'next/navigation'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldNav } from '@/components/field/field-nav'
import { PhoneBeacon } from '@/components/field/phone-beacon'
import { NativeBridge } from '@/components/native-bridge'
import { NamePlace, type PlaceDue } from '@/components/field/name-place'
import { getCountStatus } from '@/lib/store-count-status'

export const dynamic = 'force-dynamic'

/**
 * The phone shell. Each screen owns its own header, because the home screen
 * greets and the sheet screens carry a brand block instead.
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(FIELD_ROLES)
  // New staff see the walkthrough first, once (037). Undefined before the
  // migration runs, so nobody is sent there until it exists.
  if (session.profile.onboarded_at === null) redirect('/welcome')

  // Postgres is the authority on who may file a report; the nav just asks it.
  const supabase = await createServerSupabase()
  // The Count tab only appears while a count is due: asked for, or month end.
  const [{ data: canFileReport }, countStatus, { data: myStores }, { data: xmStores }, { data: placeDue }] = await Promise.all([
    supabase.rpc('can_file_report'),
    getCountStatus(supabase),
    supabase.rpc('my_outlets'),
    // X Metrics (043): the tab shows once one of their stores is in it.
    supabase.from('xm_stores').select('outlet_id').eq('is_active', true),
    // A place they must name before going on (045). Undefined before the
    // migration runs, so nothing is asked until it exists.
    supabase.rpc('my_place_due'),
  ])
  const due = ((placeDue ?? []) as PlaceDue[])[0] ?? null
  const inXm = new Set(((xmStores ?? []) as { outlet_id: string }[]).map((s) => s.outlet_id))
  const hasMetrics = ((myStores ?? []) as { id: string }[]).some((o) => inXm.has(o.id))

  return (
    <div className="field-shell min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden">
        <main className="flex-1 px-4 pb-28 pt-4">
          {due && (
            <div className="mb-4">
              <NamePlace due={due} />
            </div>
          )}
          {children}
        </main>
        <PhoneBeacon />
        <NativeBridge />
        <FieldNav canFileReport={canFileReport === true} canCountStock={countStatus.open} hasMetrics={hasMetrics} />
      </div>
    </div>
  )
}
