import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { updateConversationSchema } from '@/lib/assistant-conversations'

type Ctx = { params: Promise<{ id: string }> }

const id = z.string().uuid()

function conversationError(error: { code?: string; message: string }) {
  const missing = error.code === '42P01' || error.code === 'PGRST205'
  return Response.json(
    { error: missing ? 'Keeping conversations needs update 054 run in Supabase.' : dbErrorMessage(error) },
    { status: missing ? 503 : 400 },
  )
}

const notFound = () => Response.json({ error: 'That conversation is not there any more.' }, { status: 404 })

/** One kept conversation, whole. RLS returns it only to the person who kept it. */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = id.safeParse((await ctx.params).id)
    if (!parsed.success) return notFound()
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('assistant_conversations')
      .select('id, title, turns, updated_at')
      .eq('id', parsed.data)
      .maybeSingle()
    if (error) return conversationError(error)
    if (!data) return notFound()
    return Response.json({ conversation: data })
  } catch (error) {
    return apiError(error)
  }
}

/** Renames it, or saves its turns after a new answer. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsedId = id.safeParse((await ctx.params).id)
    if (!parsedId.success) return notFound()
    const parsed = updateConversationSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'That change could not be saved.' }, { status: 400 })
    }
    const change: Record<string, unknown> = {}
    if (parsed.data.title !== undefined) change.title = parsed.data.title
    if (parsed.data.turns !== undefined) change.turns = parsed.data.turns
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('assistant_conversations')
      .update(change)
      .eq('id', parsedId.data)
      .select('id, title, updated_at, turn_count')
      .maybeSingle()
    if (error) return conversationError(error)
    if (!data) return notFound()
    return Response.json({ conversation: data })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = id.safeParse((await ctx.params).id)
    if (!parsed.success) return notFound()
    const supabase = await createServerSupabase()
    const { error, count } = await supabase
      .from('assistant_conversations')
      .delete({ count: 'exact' })
      .eq('id', parsed.data)
    if (error) return conversationError(error)
    if (!count) return notFound()
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
