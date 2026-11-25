import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'
import { supportHelperMode } from '@/lib/usage-limits'
import { aiFor, aiKnowledge } from '@/lib/ai/config'
import { takeAiUse } from '@/lib/ai/quota'
import { STAFF_GUIDE_TEXT } from '@/lib/generated/staff-guide-text'
import { lagosDateString } from '@/lib/utils'
import { compatToolAnswer, type ToolDef } from '@/lib/ai/compat'

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

/** Whether any AI is set up for the staff helper (Settings → AI, 0102). */
export async function supportAssistantConfigured() {
  return Boolean(await aiFor('staff_helper'))
}

const RESPOND: ToolDef = {
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
}

const SYSTEM = `You are Xtend's in-app helper for Xpel Beauty's field staff (merchandisers and marketers). A member has sent a message about a problem. Reply to them directly, warmly and briefly, in simple English. Keep it to a few short sentences.

You can help on your own with things like:
- how to clock in or out (it needs Location, Camera and Notifications allowed; the selfie is taken in the app)
- installing the app ("Add to Home screen" on the phone; iPhone must use Safari)
- "You are off site": they are not at their store, so Xtend will not let them clock in or check in there. The box names the store to go to and has a Directions button; go inside the store, then tap "I am at the store". If they are inside and still see it, move near the door or a window and try again; if it keeps happening, call their supervisor (who can clock them in) and escalate so the store's location is checked
- what a result means: "off site" means the GPS was outside the store area; "flagged" means the location was not clear, so wait a moment outside for a better signal and try again
- "location permission is off" or a weak GPS signal
- how to change their password, file the daily report, or do a stock count
- why a clock-in or check-in did not work, and what to do, step by step:
  - marketers start the day at a store: tap Clock in, pick the store they are at, then take the selfie; clocking in also checks them in there. They cannot clock in without picking a store
  - "No stores are allocated to you yet": message the office (Messages) the stores they visit, with each store's Google Maps link (open the store in Google Maps, tap Share, copy the link); they clock in once the office adds them. This needs the office, so also escalate
  - "That store is not on your list": pick one of their own stores, or send the office the new store's name and Google Maps link (escalate)
  - "Turn on Xtend notifications": allow notifications for Xtend in the phone's settings, then try again
  - a refused selfie: face a light, hold still, whole face in the picture, never a photo of a screen or a printed picture
  - "Location required" or no location: turn Location on, allow it for Xtend ("Allow all the time" on Android, "Always" on iPhone, precise location on), move near a door or window, then try again
  - the phone's time is wrong: turn on automatic date and time
  - "No network", "Your network is weak" or "Your network is not working": turn on Mobile data, check they have data on their line, move near the door or a window or step outside, then try again. With no network a clock-in is kept on the phone and only counts once it sends; store check-ins need network; location is slower to find
  - check out of each store before leaving it; Xtend reminds them every 20 minutes while they are checked in
- general reassurance and next steps

Answer from the staff guide below (it is exactly what staff see in the app), the office's notes and the member's day, in that order. Use the guide's own words for buttons and screens. Give numbered steps when there is more than one thing to do. If none of them covers the question, do not guess: escalate.

Always end with where to read more: "You can also read the staff guide (You → How to use Xtend) for pictures of every step."

You MUST escalate to the office (set escalate true) when the issue is outside what you can do or know, for example:
- anything that needs a change to their account, store allocation, outlet, team or password reset
- pay, disputes, being marked absent or off-site wrongly, a complaint about a person
- a store, stock or safety problem at the outlet
- a phone that is broken or lost, or the app not loading at all
- anything you are not confident you can resolve from the above

Do not bring up location checks during the shift, whether location works with the app closed, the screen off or without network, alerts or messages to supervisors or the office, phone or integrity checks, VPN or fake-location detection, or anything being recorded or reviewed. If the member asks about their location, say only that Xtend uses their location to confirm they are at their store while they are on shift, and that location needs to stay on for the app to work. Do not deny anything and do not add more.

When you escalate, still reply to the member: acknowledge the issue in one or two sentences and tell them you have passed it to the office, who will follow up. Never invent a policy, a time, a name or a decision. If you do not know, escalate rather than guess.`

/** The staff guide, generated from the guide staff read (scripts/make-guide-knowledge.ts). */
const GUIDE = `# The staff guide (what staff see under You → How to use Xtend)

${STAFF_GUIDE_TEXT}`

function hhmm(t: string | null | undefined) {
  return t ? t.slice(0, 5) : null
}

/**
 * Where the member is in their day, so the helper can say what to do next:
 * their role, hours, today's clock-in and clock-out, the store they are
 * checked in at and how many stores they have. What staff can see in the
 * app themselves, nothing more.
 */
async function memberDay(admin: ReturnType<typeof createAdminSupabase>, userId: string): Promise<string> {
  try {
    const today = lagosDateString()
    const [{ data: me }, { data: marks }, { data: open }, { data: stores }] = await Promise.all([
      admin.from('profiles').select('role, shift_start, shift_end').eq('id', userId).maybeSingle<{
        role: string
        shift_start: string | null
        shift_end: string | null
      }>(),
      admin.from('attendance').select('type, created_at').eq('user_id', userId).eq('attendance_date', today),
      admin
        .from('store_visit_detail')
        .select('outlet_name, arrived_at')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('arrived_at', { ascending: false })
        .limit(1),
      admin.rpc('outlets_for_user', { target: userId }),
    ])
    const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' })
    const rows = (marks ?? []) as { type: string; created_at: string }[]
    const inAt = rows.find((r) => r.type === 'opening')
    const outAt = rows.find((r) => r.type === 'closing')
    const visit = ((open ?? []) as { outlet_name: string | null; arrived_at: string }[])[0]
    const storeCount = Array.isArray(stores) ? stores.length : null
    const lines = [
      `- Role: ${me?.role ?? 'unknown'}${me?.role === 'marketer' ? ' (starts the day at one of their stores and checks in and out of each store)' : ''}`,
      `- Their hours: ${hhmm(me?.shift_start) && hhmm(me?.shift_end) ? `${hhmm(me?.shift_start)} to ${hhmm(me?.shift_end)}` : 'not set'}`,
      `- Today: ${inAt ? `clocked in at ${at(inAt.created_at)}` : 'not clocked in yet'}${outAt ? `, clocked out at ${at(outAt.created_at)}` : ''}`,
      visit ? `- Checked in now at ${visit.outlet_name ?? 'a store'} since ${at(visit.arrived_at)}` : '- Not checked in at a store now',
      storeCount === null ? null : `- Stores allocated to them: ${storeCount}${storeCount === 0 ? ' (none yet: the office must add them)' : ''}`,
    ].filter(Boolean)
    return `# The member's day (Lagos time, now ${at(new Date().toISOString())})\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

interface ThreadMsg {
  sender_role: 'staff' | 'ai' | 'admin' | 'supervisor'
  body: string
}

/**
 * Generate and record the AI's reply for a thread. Returns what happened so
 * the route can report it; never throws for an AI/transport error (the
 * member's message is already saved), it escalates instead.
 */
export async function respondToSupportThread(
  threadId: string,
  { withinHourlyLimit = true }: { withinHourlyLimit?: boolean } = {},
): Promise<{
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

  // Past the member's hourly allowance, or a long conversation: no AI call,
  // the office answers. Told once; after that the thread is already theirs.
  if (supportHelperMode(withinHourlyLimit, messages.length) === 'office') {
    if (thread.status === 'escalated') return { replied: false, escalated: true, reply: null }
    return finish(
      admin,
      thread,
      staffName,
      true,
      "Thanks for your message. I've passed this to the office and someone will follow up with you.",
      'a long conversation, or many messages in an hour',
    )
  }

  // If there is no key, escalate straight to a person rather than go silent.
  const ai = await aiFor('staff_helper')
  if (!ai) {
    return finish(admin, thread, staffName, true, "Thanks for your message. I've passed this to the office and someone will follow up with you.")
  }

  // Their daily and hourly allowance (0109): past it, the office answers.
  const quota = await takeAiUse(thread.user_id, 'staff_helper')
  if (!quota.ok) {
    if (thread.status === 'escalated') return { replied: false, escalated: true, reply: null }
    return finish(
      admin,
      thread,
      staffName,
      true,
      "Thanks for your message. I've passed this to the office and someone will follow up with you.",
      quota.period === 'day' ? "the helper's daily limit for this person" : "the helper's hourly limit for this person",
    )
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

  // The guide (fixed, so it can be cached), then the office's notes and
  // this member's day, which change.
  const [officeNotes, day] = await Promise.all([aiKnowledge(), memberDay(admin, thread.user_id)])
  const context = [officeNotes ? `# Notes from the office\n${officeNotes}` : '', day].filter(Boolean).join('\n\n')
  const fixedSystem = `${SYSTEM}\n\n${GUIDE}`

  try {
    let out: { reply?: string; escalate?: boolean; reason?: string }
    if (ai.provider === 'anthropic') {
      const client = new Anthropic({ apiKey: ai.apiKey })
      const response = await client.messages.create({
        model: ai.model,
        max_tokens: 1024,
        system: [
          { type: 'text', text: fixedSystem, cache_control: { type: 'ephemeral' } },
          ...(context ? [{ type: 'text' as const, text: context }] : []),
        ],
        messages: convo,
        tool_choice: { type: 'tool', name: 'respond' },
        tools: [RESPOND as Anthropic.Tool],
      })
      const block = response.content.find((b) => b.type === 'tool_use')
      if (!block || block.type !== 'tool_use') {
        return finish(admin, thread, staffName, true, "Thanks for your message. I've passed this to the office and someone will follow up.")
      }
      out = block.input as typeof out
    } else {
      // OpenAI, Gemini, NVIDIA or OpenRouter (lib/ai/compat.ts).
      out = await compatToolAnswer<typeof out>(ai, {
        system: context ? `${fixedSystem}\n\n${context}` : fixedSystem,
        messages: convo.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: typeof m.content === 'string' ? m.content : String(m.content) })),
        tool: RESPOND,
      })
    }
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
