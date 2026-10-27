import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { assistantConfigured } from '@/lib/assistant'
import { AdminFrame } from '@/components/admin/admin-frame'
import { AdminLocation } from '@/components/admin/admin-location'
import { ActivityPing } from '@/components/activity-ping'
import { readXmFeatures } from '@/lib/metrics/features-server'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor', 'hr'])
  const hr = session.profile.role === 'hr'
  const readOnly = session.profile.role !== 'admin'

  // Open alerts, for the bell: location alerts and the late, early and
  // suspicious activity still to review. RLS narrows both to a
  // supervisor's own team.
  const supabase = await createServerSupabase()
  const [{ count: location }, { count: flags }, xmFeatures, testMode] = await Promise.all([
    supabase
      .from('location_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('is_resolved', false),
    supabase
      .from('integrity_flags')
      .select('id', { count: 'exact', head: true })
      .is('reviewed_at', null)
      .in('severity', ['medium', 'high']),
    // Whether X Metrics is switched on (0063), for the menu.
    readXmFeatures(supabase),
    // Test mode (0066): admins only see the banner (RLS hides the row from
    // everyone else). Missing table (0066 not run): no banner.
    readOnly
      ? Promise.resolve(false)
      : supabase
          .from('system_settings')
          .select('test_mode')
          .maybeSingle<{ test_mode: boolean }>()
          .then(({ data }) => data?.test_mode === true),
  ])
  // HR sees no alerts (0072), so no bell.
  const openAlerts =
    hr || (location === null && flags === null) ? null : (location ?? 0) + (flags ?? 0)

  return (
    <AdminFrame
      name={session.profile.full_name}
      role={hr ? 'HR' : readOnly ? 'Supervisor' : 'Admin'}
      readOnly={readOnly}
      openAlerts={openAlerts}
      assistant={assistantConfigured()}
      xmEnabled={xmFeatures.enabled}
      testMode={testMode}
      isAdmin={session.profile.role === 'admin'}
      hr={hr}
    >
      <AdminLocation />
      <ActivityPing />
      {children}
    </AdminFrame>
  )
}
