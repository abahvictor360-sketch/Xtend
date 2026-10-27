import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutoRefresh } from '@/components/admin/movement-map'
import { BASE_LABEL } from '@/lib/staff-roles'
import { preview, type InboxRow } from '@/lib/messages'
import { cn, formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Messages — Xtend' }

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await requireSession(['admin', 'supervisor', 'hr'])
  const q = ((await searchParams).q ?? '').trim().toLowerCase()
  const supabase = await createServerSupabase()

  // Only the people the viewer may message: a supervisor's own team;
  // everyone for admins and HR (0073).
  const { data, error } = await supabase.rpc('message_inbox')
  if (error) {
    return (
      <div className="space-y-5">
        <Header supervisor={session.profile.role === 'supervisor'} />
        <Alert variant="destructive">
          {error.code === 'PGRST202' || error.code === '42883'
            ? 'This page needs the messages update (0073) run in Supabase.'
            : `Could not load messages: ${error.message}`}
        </Alert>
      </div>
    )
  }

  const all = (data ?? []) as InboxRow[]
  const rows = q
    ? all.filter((r) =>
        [r.full_name, r.outlet_name, r.supervisor_name].some((v) => v?.toLowerCase().includes(q)),
      )
    : all
  const talking = rows.filter((r) => r.last_message_at)
  const quiet = rows.filter((r) => !r.last_message_at)
  const unread = all.reduce((n, r) => n + r.unread, 0)

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={60} />
      <Header supervisor={session.profile.role === 'supervisor'} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex w-full items-end gap-2 sm:w-auto">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Find a name or store"
            aria-label="Find a name or store"
            className="h-10 flex-1 sm:w-64"
          />
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Find
          </button>
        </form>
        <p className="text-sm text-muted-foreground">
          {unread === 0 ? 'Nothing unread' : `${unread} unread message${unread === 1 ? '' : 's'}`}
        </p>
      </div>

      {all.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
          No merchandisers or marketers to message yet.
        </p>
      ) : (
        <>
          <List title="Conversations" rows={talking} empty="No messages yet." />
          <List title="Start a conversation" rows={quiet} empty="Everybody here has a conversation." />
        </>
      )}
    </div>
  )
}

function Header({ supervisor }: { supervisor: boolean }) {
  return (
    <div>
      <h1 className="text-xl font-semibold">Messages</h1>
      <p className="text-sm text-muted-foreground">
        {supervisor
          ? 'Talk to the merchandisers and marketers on your team. They get your reply in their app straight away.'
          : 'Every merchandiser and marketer has one conversation with their supervisor. You can read and reply in any of them.'}
      </p>
    </div>
  )
}

function List({ title, rows, empty }: { title: string; rows: InboxRow[]; empty: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.staff_id}>
              <Link
                href={`/admin/messages/${r.staff_id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className={cn('truncate text-sm', r.unread > 0 ? 'font-bold' : 'font-semibold')}>
                      {r.full_name}
                    </span>
                    {r.unread > 0 && <Badge variant="brand">{r.unread}</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {BASE_LABEL[r.role]}
                    {r.outlet_name ? ` · ${r.outlet_name}` : ''}
                    {r.supervisor_name ? ` · reports to ${r.supervisor_name}` : ''}
                  </p>
                  {r.last_body && (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {r.last_from_staff ? '' : 'Office: '}
                      {preview(r.last_body, 90)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {r.last_message_at && <span className="hidden sm:inline">{formatLagos(r.last_message_at)}</span>}
                  <ChevronRight className="h-4 w-4" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
