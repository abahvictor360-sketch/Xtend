import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { writtenText } from '@/lib/fields'

const schema = z.object({
  kind: z.enum(['supply', 'count', 'sales']),
  id: z.string().uuid(),
  reason: writtenText(300, 3, 'the reason'),
})

/** Voids a supply, count or sales report: kept, with who and why. */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { error } = await db.rpc('xm_void', { p_kind: b.kind, p_id: b.id, p_reason: b.reason })
    const table = { supply: 'xm_supplies', count: 'xm_counts', sales: 'xm_sales' }[b.kind]
    return { error, audit: [`xm.${b.kind}.void`, table, b.id] }
  })
}
