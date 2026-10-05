import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'

/**
 * The AI that answers a field member's support message.
 *
 * It reads the whole thread, replies in plain language to what it can handle
 * on its own (how the app works, what a status means, what to do next), and
 * when the issue needs a person, or it is not sure, it says so briefly and
 * escalates the thread to the office. It never changes an account, a store
 * allocation, a password or a record: those are exactly what it escalates.
 *
 * Runs with the service-role client, because it writes the AI's reply and,
 * on escalation, pushes to the office. It is called from the support routes
 * after the member's message is saved.
 */

const MODEL = 'claude-opus-5'

export function supportAssistantConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const SYSTEM = `You are Xtend's in-app helper for Xpel Beauty's field staff (merchandisers and marketers). A member has sent a message about a problem. Reply to them directly, warmly and briefly, in simple English. Keep it to a few short sentences.

You can help on your own with things like:
- how to clock in or out (it needs Location, Camera and Notifications allowed; the selfie is taken in the app)
- installing the app ("Add to Home screen" on the phone; iPhone must use Safari)
- what a result means: "off site" means the GPS was outside the store area; "flagged" means the location was not clear, so wait a moment outside for a better signal and try again
- "location permission is off" or a weak GPS signal
- how to change their password, file the daily report, or do a store count
- general reassurance and next steps

You MUST escalate to the office (set escalate true) when the issue is outside what you can do or know, for example:
- anything that needs a change to their account, store allocation, outlet, team or password reset
- pay, disputes, being marked absent or off-site wrongly, a complaint about a person
- a store, stock or safety problem at the outlet
- a phone that is broken or lost, or the app not loading at all
- anything you are not confident you can resolve from the above

When you escalate, still reply to the member: acknowledge the issue in one or two sentences and tell them you have passed it to the office, who will follow up. Never invent a policy, a time, a name or a decision. If you do not know, escalate rather than guess.`

interface ThreadMsg {
  sender_role: 'staff' | 'ai' | 'admin' | 'supervisor'
  body: string
}

/**
 * Generate and record the AI's reply for a thread. Returns what happened so
 * the route can report it; never throws for an AI/transport error (the
 * member's message is already saved), it escalates instead.
 */
export async function respondToSupportThread(threadId: string): Promise<{
  replied: boolean
  escalated: boolean
  reply: string | null
}> {
  const admin = createAdminSupabase()

  const { data: thread } = await admin
    .from('support_threads')
    .select('id, user_id, subject, status')
    .eq('id', threadId)
    .maybeSingle<{ id: string; user_id: string; subject: string; status: string }>()
  if (!thread) return { replied: false, escalated: false, reply: null }

  const { data: rows } = await admin
    .from('support_messages')
    .select('sender_role, body')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  const messages = (rows ?? []) as ThreadMsg[]

  const staffName = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', thread.user_id)
    .maybeSingle<{ full_name: string }>()
    .then((r) => r.data?.full_name ?? 'the member')

  // If there is no key, escalate straight to a person rather than go silent.
  if (!supportAssistantConfigured()) {
    return finish(admin, thread, staffName, true, "Thanks for your message. I've passed this to the office and someone will follow up with you.")
  }

  // Map the thread to a Claude conversation: the member and office are the
  // "user" side, the AI's past replies are the "assistant" side.
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.sender_role === 'ai' ? 'assistant' : 'user',
    content: m.sender_role === 'ai' ? m.body : `[${m.sender_role}] ${m.body}`,
  }))
  // The API needs the first turn to be from the user.
  if (convo.length === 0 || convo[0].role !== 'user') {
    convo.unshift({ role: 'user', content: thread.subject })
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM }],
      messages: convo,
      tool_choice: { type: 'tool', name: 'respond' },
      tools: [
        {
          name: 'respond',
          description: 'Reply to the field member and decide whether to escalate to the office.',
          input_schema: {
            type: 'object',
            properties: {
              reply: { type: 'string', description: 'The message shown to the member. A few short sentences.' },
              escalate: { type: 'boolean', description: 'True when the issue needs a person or you are unsure.' },
              reason: { type: 'string', description: 'One short line for the office on why this was escalated.' },
            },
            required: ['reply', 'escalate'],
          },
        },
      ],
    })

    const block = response.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') {
      return finish(admin, thread, staffName, true, "Thanks for your message. I've passed this to the office and someone will follow up.")
    }
    const out = block.input as { reply?: string; escalate?: boolean; reason?: string }
    const reply = (out.reply ?? '').trim() || "Thanks for your message. I've passed this to the office."
    return finish(admin, thread, staffName, out.escalate !== false ? out.escalate === true : false, reply, out.reason)
  } catch (err) {
    console.error('support assistant failed', err)
    return finish(admin, thread, staffName, true, "Thanks for your message. I've passed this to the office and someone will follow up with you.")
  }
}

async function finish(
  admin: ReturnType<typeof createAdminSupabase>,
  thread: { id: string; user_id: string; subject: string },
  staffName: string,
  escalate: boolean,
  reply: string,
  reason?: string,
): Promise<{ replied: boolean; escalated: boolean; reply: string }> {
  await admin.from('support_messages').insert({
    thread_id: thread.id,
    sender_id: null,
    sender_role: 'ai',
    body: reply.slice(0, 4000),
  })

  await admin
    .from('support_threads')
    .update({
      status: escalate ? 'escalated' : 'ai_answered',
      escalated_at: escalate ? new Date().toISOString() : null,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', thread.id)

  if (escalate) {
    await notifyWatchers({
      subjectId: thread.user_id,
      title: `${staffName}: issue needs the office`,
      body: `${thread.subject}${reason ? ` — ${reason}` : ''}. Open Support to reply.`,
      url: '/admin/support',
      detail: { kind: 'support_escalated', thread_id: thread.id },
    })
  }

  return { replied: true, escalated: escalate, reply }
}
