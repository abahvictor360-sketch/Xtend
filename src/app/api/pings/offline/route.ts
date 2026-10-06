import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'

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
      }),
    )
    .min(1)
    .max(500),
})

/**
 * Positions the heartbeat kept on the phone while it had no network, sent
 * together on reconnect. Checked and stored at the time each was taken by
 * record_offline_pings() (migration 029).
 */
export async function POST(request: Request) {
  try {
    await requireApiSession([...FIELD_ROLES])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid positions' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('record_offline_pings', {
      p_points: parsed.data.points,
      p_sent_at: parsed.data.sent_at,
    })
    // Before migration 029 there is nowhere to put them: the phone keeps
    // them (a 5xx is retried) until there is.
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      return Response.json({ error: dbErrorMessage(error) }, { status: missing ? 503 : 400 })
    }
    return Response.json({ kept: data as number })
  } catch (error) {
    return apiError(error)
  }
}
