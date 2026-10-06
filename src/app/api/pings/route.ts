import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, FIELD_ROLES, dbErrorMessage } from '@/lib/auth'
import { notifyWatchers } from '@/lib/notify'
import { resolvePlace } from '@/lib/geocode'
import { HEARTBEAT_GEOFENCE_M } from '@/lib/geo'
import { sweepExpiredSelfies } from '@/lib/retention-server'
import { flushFlagAlerts } from '@/lib/flag-alerts'

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

    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

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
        // Name the spot once, here, rather than geocoding every ping: this
        // runs at most once per person per 30 minutes, when a breach fires.
        const place = await resolvePlace(parsed.data.lat, parsed.data.lng, null, {
          supabase,
          learn: true,
        })
        if (place.label) {
          await admin
            .from('location_pings')
            .update({ place_name: place.label })
            .eq('id', data.id)
        }

        await notifyWatchers({
          subjectId: session.userId,
          title: `${session.profile.full_name} left the outlet`,
          body:
            `Now at ${place.label}, ` +
            `${Math.round(data.distance_m ?? 0)} m from where they clocked in.`,
          url: '/admin',
          detail: { kind: 'left_geofence', alert_id: raised[0].id, place: place.label },
        })
      }
    }

    // Photos expire 24 hours after capture, and a nightly cron alone would
    // let some linger most of a second day. The heartbeat runs all through
    // the working day, so it drives the sweep too. The database throttles
    // it to once every few minutes and returns at once otherwise, so this
    // is awaited rather than left dangling in a function about to end.
    try {
      await sweepExpiredSelfies(createAdminSupabase())
    } catch (sweepError) {
      // A ping is never worth failing over a housekeeping job.
      console.error('selfie sweep failed', sweepError)
    }

    // Any flag this raised goes to the person's admins and supervisor now.
    await flushFlagAlerts()

    return Response.json({ ping: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
