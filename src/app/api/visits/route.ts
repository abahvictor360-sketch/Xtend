import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, REPORTING_ROLES } from '@/lib/auth'
import { notifyWatchers } from '@/lib/notify'

/**
 * Check in to a store. Naming the store is optional: left out, the
 * database picks whichever of the person's own stores they are closest to.
 * Either way it measures the distance itself and decides the status.
 */
const schema = z.object({
  outlet_id: z.string().uuid().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  address: z.string().max(500).nullable().optional(),
  place_name: z.string().max(200).nullable().optional(),
  selfie_path: z.string().min(1).max(300).nullable().optional(),
  thumb_path: z.string().min(1).max(300).nullable().optional(),
  device_info: z.record(z.unknown()).default({}),
  client_captured_at: z.string().datetime({ offset: true }),
})

export async function POST(request: Request) {
  try {
    // Marketers move between stores; merchandisers use the daily clock.
    const session = await requireApiSession(REPORTING_ROLES)
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid check-in' },
        { status: 400 },
      )
    }
    const input = parsed.data

    if (input.selfie_path && !input.selfie_path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'Selfie path does not belong to you' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('store_visits')
      .insert({
        // Null lets the trigger choose; it is never left null on the row.
        outlet_id: input.outlet_id ?? null,
        arrived_lat: input.lat,
        arrived_lng: input.lng,
        arrived_accuracy_m: input.accuracy_m,
        arrived_address: input.address ?? null,
        arrived_place_name: input.place_name ?? null,
        selfie_path: input.selfie_path ?? null,
        thumb_path: input.thumb_path ?? null,
        device_info: input.device_info,
        client_captured_at: input.client_captured_at,
      })
      .select('id, outlet_id, arrived_at, arrived_status, arrived_distance_m, outlet_radius_m')
      .single<{
        id: string
        outlet_id: string
        arrived_at: string
        arrived_status: string
        arrived_distance_m: number | null
        outlet_radius_m: number | null
      }>()

    if (error) {
      if (error.code === '23505') {
        return Response.json(
          { error: 'You are already checked in to a store. Check out of it first.' },
          { status: 409 },
        )
      }
      if (error.message.includes('Only marketers')) {
        return Response.json({ error: 'Only marketers record store visits.' }, { status: 403 })
      }
      if (error.message.includes('no stores allocated')) {
        return Response.json(
          { error: 'You have no stores allocated. Ask your supervisor to add some.' },
          { status: 400 },
        )
      }
      if (error.message.includes('not one of yours')) {
        return Response.json(
          { error: 'That store is not allocated to you. Ask your supervisor to add it.' },
          { status: 403 },
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

    // The store may have been chosen by the database, and when they are
    // not inside one of their own the map names the premises instead, so
    // both come from the row that was written rather than the request.
    const { data: detail } = await supabase
      .from('store_visit_detail')
      .select('outlet_name, store_label, store_label_source')
      .eq('id', data.id)
      .maybeSingle<{
        outlet_name: string
        store_label: string
        store_label_source: 'outlet' | 'map'
      }>()
    const outlet = detail ? { name: detail.outlet_name } : null

    if (data.arrived_status !== 'on_site') {
      await notifyWatchers({
        subjectId: session.userId,
        title:
          detail?.store_label_source === 'map'
            ? `${session.profile.full_name} checked in at ${detail.store_label}`
            : `${session.profile.full_name} checked in away from ${outlet?.name ?? 'the store'}`,
        body:
          data.arrived_distance_m === null
            ? 'The location could not be verified.'
            : `${Math.round(data.arrived_distance_m)} m from ${outlet?.name ?? 'the store'}` +
              (detail?.store_label_source === 'map' ? ', which is not one of their stores.' : '.'),
        url: '/admin/visits',
        detail: { kind: 'store_visit_off_site', visit_id: data.id },
      })
    }

    return Response.json(
      {
        visit: {
          ...data,
          outlet_name: detail?.outlet_name ?? null,
          store_label: detail?.store_label ?? null,
          store_label_source: detail?.store_label_source ?? null,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    return apiError(error)
  }
}
