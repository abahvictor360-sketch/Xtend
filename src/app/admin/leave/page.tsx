import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { LeaveDecisions, type LeaveItem } from '@/components/admin/leave-decisions'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { buttonVariants } from '@/components/ui/button'
import { lagosDateString, longDate } from '@/lib/utils'
import { CalendarCheck, CalendarDays, CalendarX, Hourglass, ListChecks, Plane } from 'lucide-react'
import { Chip, PageHeader, SectionTitle, StatCard, StatGrid } from '@/components/admin/page-kit'
import { LEAVE_STATUS, isLeaveStatus, sortLeave } from '@/lib/schedule'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Leave — Xtend' }

type Search = { status?: string; person?: string; from?: string; to?: string }
const DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function LeaveAdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession(['admin', 'supervisor', 'hr'])
  const isAdmin = session.profile.role === 'admin' || session.profile.role === 'hr'
  const params = await searchParams
  const status = isLeaveStatus(params.status) ? params.status : null
  const person = typeof params.person === 'string' && /^[0-9a-f-]{36}$/i.test(params.person) ? params.person : null
  const from = typeof params.from === 'string' && DATE.test(params.from) ? params.from : null
  const to = typeof params.to === 'string' && DATE.test(params.to) ? params.to : null
  const today = lagosDateString()

  const supabase = await createServerSupabase()
  // leave_request_detail is security_invoker: a supervisor sees their own
  // team's requests only (migration 059).
  let q = supabase.from('leave_request_detail').select('*').order('from_date', { ascending: false }).limit(500)
  if (status) q = q.eq('status', status)
  if (person) q = q.eq('user_id', person)
  if (from) q = q.gte('to_date', from)
  if (to) q = q.lte('from_date', to)

  const [{ data, error }, { data: pending }, { data: staff }] = await Promise.all([
    q,
    supabase.from('leave_requests').select('id').eq('status', 'pending').limit(500),
    supabase.from('profiles').select('id, full_name').in('role', ['merchandiser', 'marketer']).order('full_name'),
  ])
  const rows = sortLeave((data ?? []) as LeaveItem[])
  const waiting = (pending ?? []).length
  const narrowed = Boolean(status || person || from || to)
  const approved = rows.filter((r) => r.status === 'approved').length
  const rejected = rows.filter((r) => r.status === 'rejected').length
  const awayToday = rows.filter((r) => r.status === 'approved' && r.from_date <= today && r.to_date >= today).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        note={`${isAdmin ? 'Leave requests from every merchandiser and marketer.' : 'Leave requests from your team.'} Requests still waiting come first.`}
        chips={<Chip icon={CalendarDays}>{longDate(today)}</Chip>}
      />

      <StatGrid>
        <StatCard
          icon={Hourglass}
          label="Waiting for you"
          value={String(waiting)}
          tone={waiting ? 'warn' : 'muted'}
          note={waiting ? 'Approve or reject each one' : 'Nothing waiting'}
          href={waiting && status !== 'pending' ? '/admin/leave?status=pending' : undefined}
        />
        <StatCard icon={Plane} label="Away today" value={String(awayToday)} tone="brand" note="Approved leave covering today" />
        <StatCard
          icon={CalendarCheck}
          label="Approved"
          value={String(approved)}
          tone="good"
          note={narrowed ? 'In this view' : 'Latest 500 requests'}
          bar={rows.length ? (approved / rows.length) * 100 : null}
        />
        <StatCard
          icon={CalendarX}
          label="Rejected"
          value={String(rejected)}
          tone={rejected ? 'bad' : 'muted'}
          note={narrowed ? 'In this view' : 'Latest 500 requests'}
          bar={rows.length ? (rejected / rows.length) * 100 : null}
        />
      </StatGrid>

      <form className="surface flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:p-5">
        <div className="space-y-1.5 sm:w-40">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={status ?? 'all'} className="h-10 text-sm">
            <option value="all">Any</option>
            {Object.entries(LEAVE_STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:w-56">
          <Label htmlFor="person">Person</Label>
          <Select id="person" name="person" defaultValue={person ?? ''} className="h-10 text-sm">
            <option value="">Everyone</option>
            {((staff ?? []) as { id: string; full_name: string }[]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={from ?? ''} className="h-10 px-3 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={to ?? ''} className="h-10 px-3 text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Show
          </button>
          {narrowed && (
            <Link href="/admin/leave" className={buttonVariants({ size: 'sm', variant: 'ghost', className: 'h-10' })}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {error ? (
        <Alert variant="destructive">Could not load leave requests: {error.message}</Alert>
      ) : (
        <section className="space-y-3">
          <SectionTitle
            icon={ListChecks}
            title="Requests"
            note={`${rows.length} request${rows.length === 1 ? '' : 's'}${narrowed ? ' matching' : ''} · approved days are not counted as absent, and the person gets a message either way`}
          />
          <LeaveDecisions rows={rows} selfId={session.userId} today={today} />
        </section>
      )}
    </div>
  )
}
