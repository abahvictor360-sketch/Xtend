import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen } from '@/components/field/screen'
import { SupportChat, type SupportThread, type SupportMessage } from '@/components/field/support-chat'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Message support — Xtend' }

export default async function SupportPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  // RLS returns only this member's own threads and their messages.
  const { data: threads } = await supabase
    .from('support_threads')
    .select('id, subject, status, created_at, last_message_at')
    .order('last_message_at', { ascending: false })
    .limit(50)

  const ids = (threads ?? []).map((t) => t.id)
  const { data: messages } = ids.length
    ? await supabase
        .from('support_messages')
        .select('id, thread_id, sender_role, body, created_at')
        .in('thread_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] }

  return (
    <SheetScreen title="Message support" back="/field/account">
      <SupportChat
        threads={(threads ?? []) as SupportThread[]}
        messages={(messages ?? []) as SupportMessage[]}
        staffName={session.profile.full_name}
      />
    </SheetScreen>
  )
}
