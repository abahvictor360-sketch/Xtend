import { z } from 'zod'
import { apiError, requireApiSession } from '@/lib/auth'
import { POST as sendNotification } from '@/app/api/admin/notifications/route'

const schema = z.object({ user_ids: z.array(z.string().uuid()).min(1).max(500) })

/**
 * Reminds people on an old app to install the new one: a notification that
 * opens the download page, through the notifications route (reach checks,
 * delivery log, audit).
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Pick who to remind' }, { status: 400 })
    const res = await sendNotification(
      new Request(new URL('/api/admin/notifications', request.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Update your Xtend app',
          body: 'A new version of the Xtend app is ready. Tap to install it; your account and records are kept.',
          url: '/download',
          audience: 'users',
          user_ids: parsed.data.user_ids,
        }),
      }),
    )
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } })
  } catch (error) {
    return apiError(error)
  }
}
