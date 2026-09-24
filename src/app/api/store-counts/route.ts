import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'

const schema = z.object({
  outlet_id: z.string().uuid(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        in_store: z.number().int().min(0).max(1_000_000),
        sold: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, 'Count at least one product')
    .max(500),
})

/**
 * Today's store count. Whether the store is theirs, which day it is, and
 * who counted are all decided by submit_store_count() in Postgres.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['merchandiser', 'marketer', 'admin'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid count' },
        { status: 400 },
      )
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('submit_store_count', {
      p_outlet_id: parsed.data.outlet_id,
      p_lines: parsed.data.lines,
    })
    if (error) return Response.json({ error: error.message }, { status: 400 })

    return Response.json({ saved: data ?? 0 }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
