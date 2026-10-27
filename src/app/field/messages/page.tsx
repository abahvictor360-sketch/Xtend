import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen } from '@/components/field/screen'
import { Conversation } from '@/components/messages/conversation'
import type { ChatMessage } from '@/lib/messages'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Messages — Xtend' }

export default async function FieldMessagesPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  // Always their own conversation, whatever is passed (0073).
  const [{ data: messages }, { data: supervisor }] = await Promise.all([
    supabase.rpc('conversation', { p_staff: null }),
    supabase.rpc('my_supervisor_name'),
  ])
  const to = (supervisor as string | null) ?? 'the office'

  return (
    <SheetScreen title="Messages" back="/field/account">
      <p className="mb-4 text-sm text-muted-foreground">
        Talk to {to} about your work: stock, the store, your shift or anything you need.
      </p>
      <Conversation
        messages={(messages ?? []) as ChatMessage[]}
        userId={session.userId}
        emptyText={`No messages yet. Write to ${to} below.`}
        placeholder={`Message ${to}`}
      />
    </SheetScreen>
  )
}
