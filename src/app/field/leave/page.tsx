import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen, HeaderField, SectionHeader } from '@/components/field/screen'
import { LeaveForm, LeaveList } from '@/components/field/leave-form'
import { Alert } from '@/components/ui/alert'
import { lagosDateString } from '@/lib/utils'
import { sortLeave, type LeaveRow } from '@/lib/schedule'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Leave — Xtend' }

export default async function LeavePage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()
  const [{ data: serverToday }, { data, error }] = await Promise.all([
    supabase.rpc('business_date'),
    // RLS: your own requests only (migration 059).
    supabase
      .from('leave_requests')
      .select('id, user_id, kind, from_date, to_date, reason, status, decision_note, decided_at, created_at')
      .eq('user_id', session.userId)
      .order('from_date', { ascending: false })
      .limit(60),
  ])
  const today = (serverToday as string) ?? lagosDateString()
  const rows = sortLeave((data ?? []) as LeaveRow[])
  const waiting = rows.filter((r) => r.status === 'pending').length
  const canApply = session.profile.role === 'merchandiser' || session.profile.role === 'marketer'

  return (
    <SheetScreen
      title="Leave"
      back="/field/account"
      header={
        <>
          <HeaderField label="Name" value={session.profile.full_name} />
          <HeaderField label="Waiting for an answer" value={waiting ? `${waiting} request${waiting === 1 ? '' : 's'}` : 'None'} />
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <SectionHeader title="Ask for leave" />
          {canApply ? (
            <>
              <p className="text-xs text-muted-foreground">
                Pick the type, your first and last day of leave, and say why. Your supervisor approves it, and you get a
                message when they do.
              </p>
              <LeaveForm today={today} existing={rows} />
            </>
          ) : (
            <Alert variant="info">Leave requests are for merchandisers and marketers.</Alert>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeader title="Your requests" />
          {error ? (
            <Alert variant="destructive">Could not load your requests. Pull down to retry.</Alert>
          ) : (
            <LeaveList rows={rows} />
          )}
        </section>
      </div>
    </SheetScreen>
  )
}
