import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { fetchAttendance, type AttendanceFilter } from '@/lib/export/data'
import { AttendanceFilters } from '@/components/admin/attendance-filters'
import { AttendanceTable } from '@/components/admin/attendance-table'
import type { Outlet, Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Attendance — Xtend' }

type Search = Record<string, string | string[] | undefined>

function one(search: Search, key: string) {
  const value = search[key]
  const single = Array.isArray(value) ? value[0] : value
  return single && single !== 'all' ? single : null
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const supabase = await createServerSupabase()

  const filter: AttendanceFilter = {
    from: one(search, 'from'),
    to: one(search, 'to'),
    user_id: one(search, 'user_id'),
    outlet_id: one(search, 'outlet_id'),
    status: one(search, 'status'),
    type: one(search, 'type'),
    limit: 500,
  }

  const [rows, { data: staff }, { data: outlets }] = await Promise.all([
    fetchAttendance(supabase, filter),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('outlets').select('id, name').order('name'),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} record{rows.length === 1 ? '' : 's'} · times are Africa/Lagos · records are
          append-only
        </p>
      </div>

      <AttendanceFilters
        staff={(staff ?? []) as Pick<Profile, 'id' | 'full_name'>[]}
        outlets={(outlets ?? []) as Pick<Outlet, 'id' | 'name'>[]}
      />

      <AttendanceTable rows={rows} />
    </div>
  )
}
