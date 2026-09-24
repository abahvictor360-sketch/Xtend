import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sku: z.string().trim().max(60).nullable().optional(),
  is_active: z.boolean().optional(),
})

/** Renames a product or takes it off the list. Past counts keep pointing at it. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid change' }, { status: 400 })

    const changes = { ...parsed.data }
    if (changes.sku === '') changes.sku = null

    const supabase = await createServerSupabase()
    const { error } = await supabase.from('products').update(changes).eq('id', id)
    if (error) {
      const taken = error.code === '23505'
      return Response.json(
        { error: taken ? 'A product with that name already exists.' : error.message },
        { status: taken ? 409 : 400 },
      )
    }
    await audit(supabase, 'product.update', 'products', id, changes)
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
