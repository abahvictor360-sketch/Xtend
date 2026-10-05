import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { NATIVE_PREFIX } from '@/lib/push-native'

const schema = z.object({
  platform: z.enum(['android', 'ios']),
  // FCM tokens are long base64url-ish strings; APNs tokens are hex.
  token: z.string().regex(/^[A-Za-z0-9_:-]{20,4096}$/),
})

/**
 * The Xtend Android or iOS app registers the phone's own push token
 * (Firebase or Apple). Stored next to web subscriptions, so everything
 * that pushes to a person reaches the app too (lib/push-native.ts).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid device token' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: session.userId,
        endpoint: `${NATIVE_PREFIX[parsed.data.platform]}${parsed.data.token}`,
        // Web push keys do not apply to an app.
        p256dh: 'native',
        auth: 'native',
        user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
        is_active: true,
        failure_count: 0,
      },
      { onConflict: 'endpoint' },
    )
    if (error) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ subscribed: true }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
