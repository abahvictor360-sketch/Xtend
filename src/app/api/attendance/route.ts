import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'
import { notifyWatchers } from '@/lib/notify'

/**
 * The client sends what it observed. distance_m, status, user_id and
 * attendance_date are all set by the database trigger; anything the client
 * puts in those fields would be ignored, so it is not accepted here either.
 */
const schema = z.object({
  type: z.enum(['opening', 'closing']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  address: z.string().max(500).nullable().optional(),
  place_name: z.string().max(200).nullable().optional(),
  place_source: z.enum(['outlet', 'known', 'google', 'osm', 'coordinates']).nullable().optional(),
  selfie_path: z.string().min(1).max(300),
  thumb_path: z.string().min(1).max(300).nullable().optional(),
  device_info: z.record(z.unknown()).default({}),
  client_captured_at: z.string().datetime({ offset: true }),
})

export async function POST(request: Request) {
  try {
    const session = await requireApiSession(FIELD_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid submission' },
        { status: 400 },
      )
    }
    const input = parsed.data

    // The selfie must live in the caller's own folder. Storage enforces this
    // too; rejecting here gives the user a readable error instead of a 403.
    if (!input.selfie_path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'Selfie path does not belong to you' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('attendance')
      .insert({
        type: input.type,
        lat: input.lat,
        lng: input.lng,
        accuracy_m: input.accuracy_m,
        address: input.address ?? null,
        place_name: input.place_name ?? null,
        place_source: input.place_source ?? null,
        selfie_path: input.selfie_path,
        thumb_path: input.thumb_path ?? null,
        device_info: input.device_info,
        client_captured_at: input.client_captured_at,
      })
      .select(
        'id, type, status, distance_m, address, accuracy_m, created_at, outlet_radius_m, outlet_id',
      )
      .single()

    if (error) {
      if (error.code === '23505') {
        return Response.json(
          {
            error:
              input.type === 'opening'
                ? 'You have already clocked in today.'
                : 'You have already clocked out today.',
          },
          { status: 409 },
        )
      }
      if (error.message.includes('Invalid capture timestamp')) {
        return Response.json(
          { error: 'That capture is too old or your phone clock is wrong. Try again now.' },
          { status: 400 },
        )
      }
      return Response.json({ error: error.message }, { status: 400 })
    }

    // An off-site or flagged clock event is worth interrupting someone
    // for, so the office hears about it now rather than when they next open
    // the dashboard. The database has already written the location_alerts
    // row; this only carries it to a phone.
    // Not measured at all (no store, or one waiting for its location) is
    // not news; the database raises no alert for it either.
    if (data && (data.status === 'off_site' || data.status === 'flagged')) {
      const event = data.type === 'opening' ? 'clocked in' : 'clocked out'
      const distance =
        data.distance_m === null
          ? 'an unverified location'
          : `${Math.round(data.distance_m)} m from the outlet`
      const where = input.place_name
        ? ` at ${input.place_name}`
        : input.address
          ? ` at ${input.address.split(',').slice(0, 2).join(',')}`
          : ''

      await notifyWatchers({
        subjectId: session.userId,
        title:
          data.status === 'off_site'
            ? `${session.profile.full_name} ${event} off site`
            : `${session.profile.full_name}: ${event}, flagged`,
        body:
          data.status === 'off_site'
            ? `${distance}${where}.`
            : `Location could not be verified${where}. Fix accuracy ±${Math.round(data.accuracy_m)} m.`,
        url: '/admin/attendance',
        detail: { kind: 'attendance_off_site', attendance_id: data.id, status: data.status },
      })
    }

    // The trigger measures against whichever of the person's stores they
    // are nearest, which may not be their home outlet, so the response says
    // which one it actually used rather than leaving the app to guess.
    const outletId = (data as { outlet_id: string | null }).outlet_id
    let outlet_name: string | null = null
    if (outletId) {
      const { data: outlet } = await supabase
        .from('outlets')
        .select('name')
        .eq('id', outletId)
        .maybeSingle<{ name: string }>()
      outlet_name = outlet?.name ?? null
    }

    // Clocking out ends a merchandiser's or marketer's login for the day;
    // the app shows the result, then signs them out.
    const sign_out =
      data?.type === 'closing' &&
      (session.profile.role === 'merchandiser' || session.profile.role === 'marketer')

    return Response.json({ attendance: { ...data, outlet_name }, sign_out }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
