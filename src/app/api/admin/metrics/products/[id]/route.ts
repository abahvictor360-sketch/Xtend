import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { productSchema } from '@/lib/metrics/schemas'

const schema = productSchema.partial().extend({ is_active: z.boolean().optional() })

/** Edits a product, or retires it (it stays on every record that has it). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return xmAdminAction(request, schema, async (body, db) => {
    const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
    const { error } = await db.from('products').update(changes).eq('id', id)
    return { error, audit: ['xm.product.update', 'products', id] }
  })
}
