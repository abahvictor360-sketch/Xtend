import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { thingName, writtenText } from '@/lib/fields'
import { audit } from '@/lib/audit'

const schema = z.object({
  title: thingName(60, 'the name'),
  body: writtenText(1000, 2, 'the reply', true),
})

/** Save an answer to reuse. {name} becomes the member's first name. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Give it a name and a reply.' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('support_quick_replies')
      .insert({ title: parsed.data.title, body: parsed.data.body, created_by: session.userId })
      .select('id, title, body, created_by')
      .single()
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'support_reply.create', 'support_quick_replies', data.id, { title: data.title })
    return Response.json(data, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

/** Remove one: your own, or any as an admin (RLS decides). */
export async function DELETE(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: 'Which quick reply?' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.from('support_quick_replies').delete().eq('id', id).select('id, title')
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    if (!data?.length) return Response.json({ error: 'You can only remove quick replies you saved.' }, { status: 403 })
    await audit(supabase, 'support_reply.delete', 'support_quick_replies', id, { title: data[0].title })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
