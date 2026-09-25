import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { IntegrityFlags, type FlagRow } from '@/components/admin/integrity-flags'
import { addDays, lagosDateString } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Integrity checks — Xtend' }

export default async function IntegrityPage() {
  await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  // RLS narrows this to the supervisor's own team; an admin sees everyone.
  const { data, error } = await supabase
    .from('integrity_flag_detail')
    .select('*')
    .gte('flag_date', addDays(lagosDateString(), -30))
    .order('created_at', { ascending: false })
    .limit(500)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Integrity checks</h1>
        <p className="text-sm text-muted-foreground">
          Things that look wrong in the last 30 days: signs of a fake-location app, and store
          counts that do not add up. A flag is a reason to look, not proof. Check with the person,
          then mark it reviewed with what you found. Staff do not see these.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">
          The checks could not be loaded. Has migration 022 been run in Supabase?
        </p>
      ) : (
        <IntegrityFlags flags={(data ?? []) as FlagRow[]} />
      )}
    </div>
  )
}
