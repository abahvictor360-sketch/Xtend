import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { askAssistant, assistantConfigured } from '@/lib/assistant'

export const maxDuration = 60

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
})

export async function POST(request: Request) {
  try {
    // The assistant reads through the caller's own session, so a supervisor
    // only ever gets answers about the people RLS lets them see.
    const session = await requireApiSession(['admin', 'supervisor'])
    if (!assistantConfigured()) {
      return Response.json(
        { error: 'The assistant is not set up. Add ANTHROPIC_API_KEY to the environment.' },
        { status: 503 },
      )
    }

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Type a question to ask.' }, { status: 400 })
    }
    const history = parsed.data.messages
    if (history[history.length - 1].role !== 'user') {
      return Response.json({ error: 'The last message must be a question.' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const who = `${session.profile.full_name} (${session.profile.role})`
    const answer = await askAssistant(supabase, history, who)
    return Response.json({ answer })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'The assistant is busy. Try again in a moment.' }, { status: 429 })
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: 'The assistant could not answer right now.' }, { status: 502 })
    }
    return apiError(error)
  }
}
