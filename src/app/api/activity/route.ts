import { z } from 'zod'
import { apiError, requireApiSession } from '@/lib/auth'
import { recordActivity } from '@/lib/activity-server'

/**
 * The signed-in person's app opening or signing out (migration 062). Signing
 * in, a new password and a new photo are recorded where they happen, on the
 * server, so they are not accepted here. Always answers quickly; the
 * database keeps one app open per 30 minutes.
 */
const schema = z.object({
  kind: z.enum(['sign_out', 'app_open']),
  platform: z.enum(['web', 'android', 'ios']).nullable().optional(),
  app_build: z.number().int().min(0).max(100_000_000).nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const session = await requireApiSession()
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
    await recordActivity(session.userId, parsed.data.kind, request.headers, {
      platform: parsed.data.platform ?? null,
      appBuild: parsed.data.app_build ?? null,
    })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
