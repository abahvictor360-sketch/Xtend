import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'
import { liveInterval, sendLivePosition } from '@/lib/follow-live-server'

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  heading: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  captured_at: z.string().datetime({ offset: true }).optional(),
})

/**
 * A quick position from the open app (migration 0070). It is never stored
 * as a location ping: while someone follows this person it goes to them
 * over Realtime (follow_live_position_for keeps only the latest, on the
 * session), and the answer says how soon to send the next one. With
 * nobody following, it does nothing and `interval_ms` is null. The usual
 * stored pings still go to /api/pings at their usual times.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const raw = await request.json().catch(() => null)
    const admin = createAdminSupabase()
    // An empty body only asks whether to speed up.
    if (raw && typeof raw === 'object' && Object.keys(raw).length === 0) {
      return Response.json({ interval_ms: await liveInterval(admin, session.userId) })
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return Response.json({ error: 'Invalid position' }, { status: 400 })
    const interval = await sendLivePosition(admin, session.userId, {
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      accuracy_m: parsed.data.accuracy_m,
      heading: parsed.data.heading ?? null,
      speed_mps: parsed.data.speed ?? null,
      captured_at: parsed.data.captured_at ?? null,
      is_mock: false,
    })
    return Response.json({ interval_ms: interval })
  } catch (error) {
    return apiError(error)
  }
}
