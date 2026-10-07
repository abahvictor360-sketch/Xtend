import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { flushFlagAlerts } from '@/lib/flag-alerts'
import { mapText } from '@/lib/fields'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry dates must be real dates')

const schema = z.object({
  outlet_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative(),
  photo_path: z.string().min(1).max(300),
  captured_at: z.string().datetime({ offset: true }),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        batch: mapText(60).transform((v) => v ?? ''),
        expiry_date: isoDate.nullable().optional(),
        on_shelf: z.number().int().min(0).max(1_000_000),
        in_backroom: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, 'Count at least one product')
    .max(500),
})

/**
 * An X Metrics stock count (migration 043): shelf and backroom by batch,
 * with expiry dates and a shelf photo, taken in the store. Where, when, who
 * and whether it is the store's opening stock are settled by xm_submit_count.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'marketer', 'admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid count' }, { status: 400 })
    }
    const body = parsed.data
    if (!body.photo_path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'That photo does not belong to you' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('xm_submit_count', {
      p_outlet: body.outlet_id,
      p_lines: body.lines.map((l) => ({ ...l, expiry_date: l.expiry_date ?? null })),
      p_lat: body.lat,
      p_lng: body.lng,
      p_accuracy_m: body.accuracy_m,
      p_photo_path: body.photo_path,
      p_captured_at: body.captured_at,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await flushFlagAlerts()
    return Response.json({ id: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
