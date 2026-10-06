import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { flushFlagAlerts } from '@/lib/flag-alerts'

const schema = z.object({
  outlet_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  photo_path: z.string().min(1).max(300),
  lines: z
    .array(
      z.object({
        product_name: z.string().trim().min(1, 'Every product needs a name').max(120),
        in_store: z.number().int().min(0).max(1_000_000),
        sold: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, 'Count at least one product')
    .max(500),
})

/**
 * A store count: product names as the merchandiser typed them, how many are
 * left, how many sold. Whether a count is due, whether the store is theirs,
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
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    // Any flag this raised goes to the person's admins and supervisor now.
    await flushFlagAlerts()

    return Response.json({ saved: data ?? 0 }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
