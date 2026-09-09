import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'

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
  selfie_path: z.string().min(1).max(300),
  thumb_path: z.string().min(1).max(300).nullable().optional(),
  device_info: z.record(z.unknown()).default({}),
  client_captured_at: z.string().datetime({ offset: true }),
})

export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'admin'])
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
        selfie_path: input.selfie_path,
        thumb_path: input.thumb_path ?? null,
        device_info: input.device_info,
        client_captured_at: input.client_captured_at,
      })
      .select('id, type, status, distance_m, address, accuracy_m, created_at, outlet_radius_m')
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

    return Response.json({ attendance: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
