import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { AlertsList } from '@/components/admin/alerts-list'
import type { AlertDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Alerts — Xtend' }

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const session = await requireSession(['admin', 'supervisor'])
  const { show } = await searchParams
  const resolved = show === 'resolved'

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('alert_detail')
    .select('*')
    .eq('is_resolved', resolved)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <AlertsList
      alerts={(data ?? []) as AlertDetail[]}
      resolved={resolved}
      canResolve={session.profile.role === 'admin'}
    />
  )
}
