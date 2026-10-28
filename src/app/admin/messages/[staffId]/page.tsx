import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Conversation } from '@/components/messages/conversation'
import { BASE_LABEL } from '@/lib/staff-roles'
import type { ChatMessage, InboxRow } from '@/lib/messages'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conversation — Xtend' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function AdminConversationPage({ params }: { params: Promise<{ staffId: string }> }) {
  const session = await requireSession(['admin', 'supervisor', 'hr'])
  const { staffId } = await params
  if (!UUID.test(staffId)) notFound()
  const supabase = await createServerSupabase()

  // can_message decides: a supervisor only reaches their own team (0073).
  const [{ data: inbox }, { data: messages }] = await Promise.all([
    supabase.rpc('message_inbox'),
    supabase.rpc('conversation', { p_staff: staffId }),
  ])
  const person = ((inbox ?? []) as InboxRow[]).find((r) => r.staff_id === staffId)
  if (!person) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-2">
        <Link
          href="/admin/messages"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All messages
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-tint-foreground">
            {person.full_name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join('')}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{person.full_name}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {BASE_LABEL[person.role]}
              {person.outlet_name ? ` · ${person.outlet_name}` : ''}
              {person.supervisor_name ? ` · reports to ${person.supervisor_name}` : ' · no supervisor'}
            </p>
          </div>
        </div>
      </div>
      <Conversation
        messages={(messages ?? []) as ChatMessage[]}
        staffId={staffId}
        userId={session.userId}
        emptyText={`No messages yet. Write to ${person.full_name.split(' ')[0]} below.`}
        placeholder={`Message ${person.full_name.split(' ')[0]}`}
      />
    </div>
  )
}
