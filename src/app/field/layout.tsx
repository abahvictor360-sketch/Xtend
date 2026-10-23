import { redirect } from 'next/navigation'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldNav } from '@/components/field/field-nav'
import { PhoneBeacon } from '@/components/field/phone-beacon'
import { NativeBridge } from '@/components/native-bridge'
import { ActivityPing } from '@/components/activity-ping'
import { NamePlace, type PlaceDue } from '@/components/field/name-place'
import { getCountStatus } from '@/lib/store-count-status'
import { readXmFeatures } from '@/lib/metrics/features-server'
import { getActingRole } from '@/lib/acting'
import { RoleSwitchBar } from '@/components/field/role-switch-bar'

export const dynamic = 'force-dynamic'

/**
 * The phone shell. Each screen owns its own header, because the home screen
 * greets and the sheet screens carry a brand block instead.
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(FIELD_ROLES)
  const isAdmin = session.profile.role === 'admin'
  // An admin can view the field app as a merchandiser or a marketer (acting);
  // the effective role drives the experience below.
  const acting = await getActingRole(session)
  // New staff see the walkthrough first, once (037). Undefined before the
  // migration runs, so nobody is sent there until it exists. Admins never did
  // the walkthrough, so they are not sent there when viewing the field app.
  if (session.profile.onboarded_at === null && !isAdmin) redirect('/welcome')

  const supabase = await createServerSupabase()
  // Who may file a report is purely role (can_file_report() is just
  // role in marketer/admin), and the session already holds the role, so read
  // it from there rather than spend a round-trip on every navigation. The
  // insert policy and trigger still enforce it in the database. An admin
  // viewing as a merchandiser sees it as a merchandiser would.
  const effectiveRole = acting ?? session.profile.role
  const canFileReport = effectiveRole === 'marketer' || effectiveRole === 'admin'
  // The Count tab only appears while a count is due: asked for, or month end.
  const [countStatus, { data: myStores }, { data: xmStores }, { data: placeDue }, xmFeatures] = await Promise.all([
    getCountStatus(supabase),
    supabase.rpc('my_outlets'),
    // X Metrics (043): the tab shows once one of their stores is in it.
    supabase.from('xm_stores').select('outlet_id').eq('is_active', true),
    // A place they must name before going on (045). Undefined before the
    // migration runs, so nothing is asked until it exists.
    supabase.rpc('my_place_due'),
    // X Metrics switched off (0063): no tab at all.
    readXmFeatures(supabase),
  ])
  const due = ((placeDue ?? []) as PlaceDue[])[0] ?? null
  const inXm = new Set(((xmStores ?? []) as { outlet_id: string }[]).map((s) => s.outlet_id))
  const hasMetrics = xmFeatures.enabled && ((myStores ?? []) as { id: string }[]).some((o) => inXm.has(o.id))

  return (
    <div className="field-shell min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden">
        <main className="flex-1 px-4 pb-28 pt-4">
          {isAdmin && <RoleSwitchBar acting={acting} />}
          {due && (
            <div className="mb-4">
              <NamePlace due={due} />
            </div>
          )}
          {children}
        </main>
        <PhoneBeacon />
        <NativeBridge />
        <ActivityPing />
        <FieldNav canFileReport={canFileReport === true} canCountStock={countStatus.open} hasMetrics={hasMetrics} />
      </div>
    </div>
  )
}
