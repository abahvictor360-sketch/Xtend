import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'
import { resolvePlace } from '@/lib/geocode'
import { flushFlagAlerts } from '@/lib/flag-alerts'

export const maxDuration = 30

const schema = z.object({
  /** The phone's clock when it sent these, to correct a wrong one. */
  sent_at: z.string().datetime({ offset: true }),
  points: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy_m: z.number().nonnegative(),
        captured_at: z.string().datetime({ offset: true }),
        is_mock: z.boolean().optional(),
      }),
    )
    .max(500),
})

interface Recorded {
  ok: boolean
  reason?: string
  user_id?: string
  kept?: number
  shift_open?: boolean
  alert?: { id: string; distance_m: number | null; ping_id: string | null; lat: number; lng: number } | null
}

/**
 * Positions from the Xtend app's native tracker, sent with the app closed
 * or the phone locked. There is no sign-in here: the phone's tracking
 * token (from /api/track/token) says whose they are, and
 * record_background_pings() (migration 050) checks it and stores them as
 * that person's. The answer tells the phone whether to keep tracking.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+([0-9a-f]{64})$/i)?.[1]
    if (!token) return Response.json({ error: 'No tracking token', stop: true }, { status: 401 })
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid positions' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('record_background_pings', {
      p_token: token,
      p_points: parsed.data.points,
      p_sent_at: parsed.data.sent_at,
    })
    if (error) {
      // Not installed yet (before 050), or the database is busy: the phone
      // keeps the positions and tries again.
      return Response.json({ error: 'Try again later' }, { status: 503 })
    }
    const got = data as Recorded
    if (!got.ok) return Response.json({ error: 'This tracking token has ended', stop: true }, { status: 401 })

    // "Left the store": tell their supervisor and admins, as the web
    // heartbeat does.
    if (got.alert && got.user_id) {
      const { data: person } = await admin.from('profiles').select('full_name').eq('id', got.user_id).single()
      const place = await resolvePlace(got.alert.lat, got.alert.lng, null, { supabase: admin, learn: false })
      if (place.label && got.alert.ping_id) {
        await admin.from('location_pings').update({ place_name: place.label }).eq('id', got.alert.ping_id)
      }
      await notifyWatchers({
        subjectId: got.user_id,
        title: `${person?.full_name ?? 'Someone'} left the outlet`,
        body: `Now at ${place.label}, ${Math.round(got.alert.distance_m ?? 0)} m from where they clocked in.`,
        url: '/admin',
        detail: { kind: 'left_geofence', alert_id: got.alert.id, place: place.label, source: 'background' },
      })
    }
    await flushFlagAlerts()

    return Response.json({ kept: got.kept ?? 0, shift_open: got.shift_open ?? false, stop: !got.shift_open })
  } catch (error) {
    console.error('background positions failed', error)
    return Response.json({ error: 'Try again later' }, { status: 503 })
  }
}
