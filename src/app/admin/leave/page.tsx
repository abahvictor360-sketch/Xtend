import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { LeaveDecisions, type LeaveItem } from '@/components/admin/leave-decisions'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { buttonVariants } from '@/components/ui/button'
import { lagosDateString } from '@/lib/utils'
import { LEAVE_STATUS, isLeaveStatus, sortLeave } from '@/lib/schedule'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Leave — Xtend' }

type Search = { status?: string; person?: string; from?: string; to?: string }
const DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function LeaveAdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Leave</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? 'Leave requests from every merchandiser and marketer.' : 'Leave requests from your team.'} Approve
          or reject each one; the person gets a message either way. Approved days are not counted as absent and nobody
          is chased for not clocking in on them. Requests still waiting come first.
        </p>
      </div>

      {waiting > 0 && (
        <Alert variant="warning">
          {waiting} request{waiting === 1 ? ' is' : 's are'} waiting for a decision.{' '}
          {status !== 'pending' && (
            <Link href="/admin/leave?status=pending" className="font-semibold text-brand hover:underline">
              Show only those
            </Link>
          )}
        </Alert>
      )}

      <form className="surface flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
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
        <LeaveDecisions rows={rows} selfId={session.userId} today={today} />
      )}
    </div>
  )
}
