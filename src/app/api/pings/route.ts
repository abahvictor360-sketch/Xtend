import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'
import { notifyWatchers } from '@/lib/notify'
import { HEARTBEAT_GEOFENCE_M } from '@/lib/geo'

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
})

/** Foreground heartbeat. The geofence decision is a database trigger. */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid ping' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('location_pings')
      .insert(parsed.data)
      .select('id, distance_m, created_at')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 400 })

    // The trigger raises a left_geofence alert at most once every 30
    // minutes. Rather than duplicating that rule here, ask whether it
    // actually fired for this ping, and only then interrupt anyone.
    if (data && (data.distance_m ?? 0) > HEARTBEAT_GEOFENCE_M) {
      const admin = createAdminSupabase()
      const { data: raised } = await admin
        .from('location_alerts')
        .select('id')
        .eq('user_id', session.userId)
        .eq('alert_type', 'left_geofence')
        .gte('created_at', data.created_at)
        .limit(1)

      if (raised && raised.length > 0) {
        await notifyWatchers({
          subjectId: session.userId,
          title: `${session.profile.full_name} left the outlet`,
          body: `Now ${Math.round(data.distance_m ?? 0)} m from where they clocked in, during their shift.`,
          url: '/admin/alerts',
          detail: { kind: 'left_geofence', alert_id: raised[0].id },
        })
      }
    }

    return Response.json({ ping: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
