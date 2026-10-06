import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { assistantConfigured } from '@/lib/assistant'
import { AdminFrame } from '@/components/admin/admin-frame'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  // Open alerts, for the bell. RLS narrows it to a supervisor's own team.
  const supabase = await createServerSupabase()
  const { count: openAlerts } = await supabase
    .from('location_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('is_resolved', false)

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
