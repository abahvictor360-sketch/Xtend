import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { assistantConfigured } from '@/lib/assistant'
import { AdminFrame } from '@/components/admin/admin-frame'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  // Open alerts, for the bell: location alerts and the late, early and
  // suspicious activity still to review. RLS narrows both to a
  // supervisor's own team.
  const supabase = await createServerSupabase()
  const [{ count: location }, { count: flags }] = await Promise.all([
    supabase
      .from('location_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('is_resolved', false),
    supabase
      .from('integrity_flags')
      .select('id', { count: 'exact', head: true })
      .is('reviewed_at', null)
      .in('severity', ['medium', 'high']),
  ])
  const openAlerts = location === null && flags === null ? null : (location ?? 0) + (flags ?? 0)

  return (
    <AdminFrame
      name={session.profile.full_name}
      role={readOnly ? 'Supervisor' : 'Admin'}
      readOnly={readOnly}
      openAlerts={openAlerts}
      assistant={assistantConfigured()}
    >
      {children}
    </AdminFrame>
  )
}
