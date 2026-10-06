import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { isWebPushEndpoint } from '@/lib/push-endpoint'

const schema = z.object({
  // Only a real push service: the server sends to this address later.
  endpoint: z
    .string()
    .max(1000)
    .refine(isWebPushEndpoint, 'That is not a push service this app can use'),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
})

/** A device registers itself for notifications. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid subscription' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: session.userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
        is_active: true,
        failure_count: 0,
      },
      { onConflict: 'endpoint' },
    )

    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ subscribed: true }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

/** The user turns notifications off on this device. */
export async function DELETE(request: Request) {
  try {
    await requireApiSession()
    const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string }
    if (!endpoint) return Response.json({ error: 'endpoint is required' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    return Response.json({ unsubscribed: true })
  } catch (error) {
    return apiError(error)
  }
}
