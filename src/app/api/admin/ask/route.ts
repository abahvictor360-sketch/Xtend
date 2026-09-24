import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { askAssistant, assistantConfigured } from '@/lib/assistant'
import { attachmentBlocks, attachmentSchema } from '@/lib/assistant-attachment'

// Reading a long allocation sheet and matching every name takes several
// model turns; a minute is not always enough.
export const maxDuration = 300

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(20000),
      }),
    )
    .min(1)
    .max(30),
  /** A file attached to the last question. */
  attachment: attachmentSchema.nullable().optional(),
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

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json(
        { error: 'Type a question to ask, or attach a file under 3 MB.' },
        { status: 400 },
      )
    }
    const history = parsed.data.messages
    if (history[history.length - 1].role !== 'user') {
      return Response.json({ error: 'The last message must be a question.' }, { status: 400 })
    }

    const attachment = parsed.data.attachment
      ? await attachmentBlocks(parsed.data.attachment)
      : []

    const supabase = await createServerSupabase()
    const reply = await askAssistant(
      supabase,
      history,
      {
        name: session.profile.full_name,
        role: session.profile.role === 'admin' ? 'admin' : 'supervisor',
      },
      attachment,
    )
    return Response.json(reply)
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'The assistant is busy. Try again in a moment.' }, { status: 429 })
    }
    if (error instanceof Anthropic.BadRequestError) {
      return Response.json(
        { error: 'The assistant could not read that. If you attached a file, try a smaller or simpler one.' },
        { status: 400 },
      )
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: 'The assistant could not answer right now.' }, { status: 502 })
    }
    return apiError(error)
  }
}
