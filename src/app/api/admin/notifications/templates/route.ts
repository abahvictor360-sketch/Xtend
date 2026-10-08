import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { thingName, writtenText } from '@/lib/fields'
import { audit } from '@/lib/audit'

const schema = z.object({
  title: thingName(80, 'title'),
  body: writtenText(400, 2, 'the message', true),
})

/** Save a title and message to reuse. RLS lets any office member add their own. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Write a title and message.' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('notification_templates')
      .insert({ title: parsed.data.title, body: parsed.data.body, created_by: session.userId })
      .select('id, title, body, created_by')
      .single()
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'notification_template.create', 'notification_templates', data.id, { title: data.title })
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
      return Response.json({ error: 'Which template?' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('notification_templates')
      .delete()
      .eq('id', id)
      .select('id, title')
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    if (!data?.length) return Response.json({ error: 'You can only remove templates you saved.' }, { status: 403 })
    await audit(supabase, 'notification_template.delete', 'notification_templates', id, { title: data[0].title })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
