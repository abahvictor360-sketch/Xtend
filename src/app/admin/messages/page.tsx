import Link from 'next/link'
import { ChevronRight, MailWarning, MessageSquarePlus, MessagesSquare, Users, type LucideIcon } from 'lucide-react'
import { EmptyState, PageHeader, SectionTitle, StatCard, StatGrid } from '@/components/admin/page-kit'
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
    <div className="space-y-6">
      <AutoRefresh seconds={60} />
      <Header supervisor={session.profile.role === 'supervisor'} />

      <StatGrid>
        <StatCard icon={Users} label="People" value={String(all.length)} note="You can message" />
        <StatCard
          icon={MessagesSquare}
          label="Conversations"
          value={String(all.filter((r) => r.last_message_at).length)}
          tone="good"
          note="With at least one message"
          bar={all.length ? (all.filter((r) => r.last_message_at).length / all.length) * 100 : null}
        />
        <StatCard
          icon={MailWarning}
          label="Unread"
          value={String(unread)}
          tone={unread ? 'bad' : 'muted'}
          note={unread ? `From ${all.filter((r) => r.unread > 0).length} ${all.filter((r) => r.unread > 0).length === 1 ? 'person' : 'people'}` : 'Nothing unread'}
        />
        <StatCard
          icon={MessageSquarePlus}
          label="No conversation yet"
          value={String(all.filter((r) => !r.last_message_at).length)}
          tone="muted"
          note="Start one below"
        />
      </StatGrid>

      <div className="surface flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5">
        <form method="get" className="flex w-full items-end gap-2 sm:w-auto">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Find a name or store"
            aria-label="Find a name or store"
            className="h-11 flex-1 sm:w-72"
          />
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-11' })}>
            Find
          </button>
        </form>
        <p className="text-sm text-muted-foreground">
          {unread === 0 ? 'Nothing unread' : `${unread} unread message${unread === 1 ? '' : 's'}`}
        </p>
      </div>

      {all.length === 0 ? (
        <EmptyState icon={MessagesSquare}>No merchandisers or marketers to message yet.</EmptyState>
      ) : (
        <>
          <List icon={MessagesSquare} title={`Conversations (${talking.length})`} rows={talking} empty="No messages yet." />
          <List icon={MessageSquarePlus} title={`Start a conversation (${quiet.length})`} rows={quiet} empty="Everybody here has a conversation." />
        </>
      )}
    </div>
  )
}

function Header({ supervisor }: { supervisor: boolean }) {
  return (
    <PageHeader
      title="Messages"
      note={
        supervisor
          ? 'Talk to the merchandisers and marketers on your team. They get your reply in their app straight away.'
          : 'Every merchandiser and marketer has one conversation with their supervisor. You can read and reply in any of them.'
      }
    />
  )
}

function List({ icon, title, rows, empty }: { icon: LucideIcon; title: string; rows: InboxRow[]; empty: string }) {
  return (
    <section className="space-y-3">
      <SectionTitle icon={icon} title={title} />
      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.staff_id}>
              <Link
                href={`/admin/messages/${r.staff_id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    r.unread > 0 ? 'bg-brand text-white' : 'bg-tint text-brand',
                  )}
                >
                  {r.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
                </span>
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
