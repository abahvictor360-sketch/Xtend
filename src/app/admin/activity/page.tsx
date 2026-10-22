import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { ActivityView } from '@/components/admin/activity-view'
import { parseActivityFilter } from '@/lib/activity-log'
import { fetchActivity } from '@/lib/activity-server'
import { lagosDateString } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Activity log — Xtend' }

/** Everybody's activity in Xtend (migration 062). Admins only. */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession(['admin'])
  const today = lagosDateString()
  const filter = parseActivityFilter(await searchParams, today)
  const supabase = await createServerSupabase()

  const [{ data: people }, result] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role').order('full_name'),
    fetchActivity(supabase, filter, 2000).catch((e: Error) => ({ error: e.message })),
  ])

  return (
    <ActivityView
      filter={filter}
      rows={'rows' in result ? result.rows : []}
      truncated={'truncated' in result ? result.truncated : false}
      people={(people ?? []) as { id: string; full_name: string; role: string }[]}
      failed={'error' in result ? `Could not load the activity log. ${result.error}` : null}
      today={today}
    />
  )
}
