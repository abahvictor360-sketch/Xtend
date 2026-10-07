import { xmAdminAction } from '@/lib/metrics/admin-route'
import { productSchema } from '@/lib/metrics/schemas'

/** Adds a product to the catalogue, with what X Metrics needs. */
export async function POST(request: Request) {
  return xmAdminAction(request, productSchema, async (body, db) => {
    const { data, error } = await db
      .from('products')
      .insert({ name: body.name, sku: body.sku ?? null, category: body.category ?? null, unit: body.unit })
      .select('id')
      .single<{ id: string }>()
    return { data, error, audit: ['xm.product.create', 'products', data?.id ?? null] }
  })
}
