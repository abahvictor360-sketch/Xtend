import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { conversationTitle, createConversationSchema } from '@/lib/assistant-conversations'

/** Said when migration 054 has not been run yet. */
function conversationError(error: { code?: string; message: string }) {
  const missing = error.code === '42P01' || error.code === 'PGRST205'
  return Response.json(
    { error: missing ? 'Keeping conversations needs update 054 run in Supabase.' : dbErrorMessage(error) },
    { status: missing ? 503 : 400 },
  )
}

/** The caller's own kept Ask Xtend conversations, newest first. RLS shows nobody else's. */
export async function GET() {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('assistant_conversations')
      .select('id, title, updated_at, turn_count')
      .order('updated_at', { ascending: false })
      .limit(100)
    if (error) return conversationError(error)
    return Response.json({ conversations: data ?? [] })
  } catch (error) {
    return apiError(error)
  }
}

/** Keeps a new conversation. */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = createConversationSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'That conversation could not be kept.' }, { status: 400 })
    }
    const firstQuestion = parsed.data.turns.find((t) => t.role === 'user')?.content ?? ''
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('assistant_conversations')
      .insert({ title: parsed.data.title ?? conversationTitle(firstQuestion), turns: parsed.data.turns })
      .select('id, title, updated_at, turn_count')
      .single()
    if (error) return conversationError(error)
    return Response.json({ conversation: data })
  } catch (error) {
    return apiError(error)
  }
}
