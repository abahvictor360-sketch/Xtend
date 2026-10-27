import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'
import { preview, sendMessageSchema } from '@/lib/messages'

/**
 * Sends a message in a staff member's conversation (0073). Postgres decides
 * who may write where; this tells the other side with a push. A staff
 * member's message goes to their supervisor, or to the admins when they
 * have none. The office's reply goes to the staff member.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'marketer', 'supervisor', 'admin', 'hr'])
    const parsed = sendMessageSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Write your message first.' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('send_message', {
      p_staff: parsed.data.staff_id ?? null,
      p_body: parsed.data.body,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    const sent = data as { staff_id: string; from_staff: boolean; supervisor_id: string | null }

    let to: string[]
    if (sent.from_staff) {
      if (sent.supervisor_id) {
        to = [sent.supervisor_id]
      } else {
        const { data: admins } = await createAdminSupabase()
          .from('profiles')
          .select('id')
          .eq('role', 'admin')
          .eq('is_active', true)
        to = ((admins ?? []) as { id: string }[]).map((a) => a.id)
      }
    } else {
      to = [sent.staff_id]
    }
    to = to.filter((id) => id !== session.userId)

    await notifyUsers(to, {
      title: `Message from ${session.profile.full_name}`,
      body: preview(parsed.data.body),
      url: sent.from_staff ? `/admin/messages/${sent.staff_id}` : '/field/messages',
      senderId: session.userId,
      detail: { kind: 'message', staff_id: sent.staff_id },
    })

    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
