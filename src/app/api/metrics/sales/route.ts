import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

const schema = z.object({
  outlet_id: z.string().uuid(),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the day'),
  photo_path: z.string().min(1).max(300).nullable().optional(),
  captured_at: z.string().datetime({ offset: true }),
  lines: z
    .array(z.object({ product_id: z.string().uuid(), units: z.number().int().min(0).max(1_000_000) }))
    .min(1, 'Enter at least one product')
    .max(500),
})

/**
 * A day's sales for one store (migration 043). Sending the same day again
 * replaces the figures; the earlier report is kept, marked superseded.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'marketer', 'admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid sales report' }, { status: 400 })
    }
    const body = parsed.data
    if (body.photo_path && !body.photo_path.startsWith(`${session.userId}/`)) {
      return Response.json({ error: 'That photo does not belong to you' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('xm_submit_sales', {
      p_outlet: body.outlet_id,
      p_sale_date: body.sale_date,
      p_lines: body.lines,
      p_photo_path: body.photo_path ?? null,
      p_captured_at: body.captured_at,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ id: data }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
