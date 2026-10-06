import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { OverviewView, type OverviewData } from '@/components/admin/overview-view'
import type { LiveLocation } from '@/components/admin/live-locations'
import type { DayCount } from '@/components/admin/overview-charts'
import { addDays, lagosDateString } from '@/lib/utils'
import { withAvatars } from '@/lib/avatars'
import type { AlertDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Overview — Xtend' }

const day = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options })

export default async function AdminOverview() {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
  const supabase = await createServerSupabase()

  const [
    { data: overview },
    { data: absentees },
    { data: coverage },
    { data: live },
    { data: alerts },
    { data: retention },
  ] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.rpc('absentees_today'),
    supabase.rpc('coverage_today'),
    supabase.rpc('live_locations'),
    supabase
      .from('alert_detail')
      .select('*')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.rpc('selfie_retention_status'),
  ])

  // The last seven days of clock-ins, on time and late, for the chart.
  const today = lagosDateString()
  const weekStart = addDays(today, -6)
  const { data: openings } = await supabase
    .from('attendance_detail')
    .select('attendance_date, is_late')
    .eq('type', 'opening')
    .gte('attendance_date', weekStart)
    .lte('attendance_date', today)
    .limit(5000)
  const week: DayCount[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    const rows = ((openings ?? []) as { attendance_date: string; is_late: boolean }[]).filter(
      (r) => r.attendance_date === date,
    )
    return {
      date,
      label: day(date, { weekday: 'short' }),
      long: day(date, { weekday: 'long', day: 'numeric', month: 'short' }),
      onTime: rows.filter((r) => !r.is_late).length,
      late: rows.filter((r) => r.is_late).length,
    }
  })

  return (
    <OverviewView
      name={session.profile.full_name}
      isAdmin={isAdmin}
      today={today}
      week={week}
      stats={(overview ?? {}) as OverviewData['stats']}
      away={(absentees ?? []) as OverviewData['away']}
      tracked={(coverage ?? []) as OverviewData['tracked']}
      onShift={await withAvatars(supabase, (live ?? []) as LiveLocation[])}
      alerts={(alerts ?? []) as AlertDetail[]}
      photos={retention as OverviewData['photos']}
    />
  )
}
