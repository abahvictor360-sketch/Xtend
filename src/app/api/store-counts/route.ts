import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage, dbErrorResponse } from '@/lib/auth'
import { flushFlagAlerts } from '@/lib/flag-alerts'
import { thingName } from '@/lib/fields'

const schema = z.object({
  outlet_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  photo_path: z.string().min(1).max(300),
  lines: z
    .array(
      z.object({
        // "7UP" has two letters; "S26" only one, so one is enough.
        product_name: thingName(120, 'product name', 1),
        // The Xpel count sheet (040): back store and shop floor, whose total
        // is what is in the store. Older phones send in_store alone.
        back_store: z.number().int().min(0).max(1_000_000).nullable().optional(),
        shop_floor: z.number().int().min(0).max(1_000_000).nullable().optional(),
        in_store: z.number().int().min(0).max(1_000_000).optional(),
        sold: z.number().int().min(0).max(1_000_000).default(0),
        expiry_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry dates must be real dates')
          .nullable()
          .optional(),
      }),
    )
    .min(1, 'Count at least one product')
    .max(500),
})

/**
 * A stock count: for each product, how many are in the back store and on the
 * shop floor, how many sold, and the expiry date. Whether a count is due, whether the store is theirs,
 * which day it is and who counted are all decided by submit_store_count().
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'marketer', 'admin'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid count' },
        { status: 400 },
      )
    }

    if (!parsed.data.photo_path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'That photo does not belong to you' }, { status: 400 })
    }

    // Being in the store, and the photo being fresh, are checked in Postgres.
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('submit_store_count', {
      p_outlet_id: parsed.data.outlet_id,
      p_lines: parsed.data.lines,
      p_lat: parsed.data.lat,
      p_lng: parsed.data.lng,
      p_accuracy_m: parsed.data.accuracy_m,
      p_photo_path: parsed.data.photo_path,
    })
    if (error) return dbErrorResponse(error)

    // Any flag this raised goes to the person's admins and supervisor now.
    await flushFlagAlerts()

    return Response.json({ saved: data ?? 0 }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
