import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { ScheduleManager, type ScheduleChange, type SchedulePerson } from '@/components/admin/schedule-manager'
import { Alert } from '@/components/ui/alert'
import { roleLabel, type StaffRole } from '@/lib/staff-roles'
import { addDays, lagosDateString } from '@/lib/utils'
import type { Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Schedules — Xtend' }

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
  const { user } = await searchParams
  const supabase = await createServerSupabase()
  const today = lagosDateString()

  // my_staff(): everyone for an admin, the supervisor's own team otherwise.
  // Patterns and changes are read through RLS too (migration 059).
  const [{ data: staff, error }, { data: patterns }, { data: changes }, { data: outlets }, { data: roles }] =
    await Promise.all([
      supabase.rpc('my_staff'),
      supabase.from('work_patterns').select('user_id, days').limit(5000),
      supabase
        .from('schedule_overrides')
        .select('id, user_id, day, working, note')
        .gte('day', addDays(today, -60))
        .order('day')
        .limit(2000),
      supabase.from('outlets').select('id, name'),
      supabase.from('staff_roles').select('id, name, base_role, is_active'),
    ])

  const profiles = ((staff ?? []) as Profile[]).filter(
    (p) => p.is_active && (p.role === 'merchandiser' || p.role === 'marketer') && p.id !== session.userId,
  )
  const outletName = new Map(((outlets ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]))
  const leadName = new Map(((staff ?? []) as Profile[]).map((p) => [p.id, p.full_name]))
  const roleById = new Map(((roles ?? []) as StaffRole[]).map((r) => [r.id, r]))
  const daysOf = new Map(((patterns ?? []) as { user_id: string; days: number[] }[]).map((p) => [p.user_id, p.days]))

  const people: SchedulePerson[] = profiles
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      role: roleLabel(p, roleById),
      store: p.outlet_id ? (outletName.get(p.outlet_id) ?? null) : null,
      team: p.supervisor_id ? `${leadName.get(p.supervisor_id) ?? 'Another'}’s team` : null,
      days: daysOf.get(p.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Schedules</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? 'Days on and days off for every merchandiser and marketer.' : 'Days on and days off for your team.'}{' '}
          A day off, or a day of approved{' '}
          <Link href="/admin/leave" className="font-semibold text-brand hover:underline">
            leave
          </Link>
          , is never counted as absent, and nobody is chased for not clocking in on one. Every change is in the audit
          log.
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">Could not load staff: {error.message}</Alert>
      ) : people.length === 0 ? (
        <Alert variant="info">There are no merchandisers or marketers to schedule yet.</Alert>
      ) : (
        <ScheduleManager
          people={people}
          changes={(changes ?? []) as ScheduleChange[]}
          today={today}
          focus={typeof user === 'string' ? user : null}
        />
      )}
    </div>
  )
}
