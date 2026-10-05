import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SupportThreads, type AdminThread, type AdminMessage } from '@/components/admin/support-threads'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Support — Xtend' }

export default async function AdminSupportPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  // RLS narrows a supervisor to their own team; an admin sees everyone.
  const { data: threads } = await supabase
    .from('support_thread_detail')
    .select('*')
    .order('last_message_at', { ascending: false })
    .limit(200)

  const ids = (threads ?? []).map((t: { id: string }) => t.id)
  const { data: messages } = ids.length
    ? await supabase
        .from('support_messages')
        .select('id, thread_id, sender_role, body, created_at')
        .in('thread_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Support</h1>
        <p className="text-sm text-muted-foreground">
          Issues field staff raised in the app. The Xtend helper answers the simple ones; anything
          marked <span className="font-medium">With the office</span> was escalated and needs a
          person. Reply here and the member gets it in their app.
        </p>
      </div>
      <SupportThreads
        threads={(threads ?? []) as AdminThread[]}
        messages={(messages ?? []) as AdminMessage[]}
        me={session.profile.full_name}
      />
    </div>
  )
}
