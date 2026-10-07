import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { mapText, note } from '@/lib/fields'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')

const schema = z.object({
  outlet_id: z.string().uuid({ message: 'Choose the store' }),
  product_id: z.string().uuid({ message: 'Choose the product' }),
  quantity: z.number().int('Whole units only').min(1, 'At least one unit').max(10_000_000),
  batch: mapText(60).transform((v) => v ?? ''),
  expiry_date: date.nullable().optional(),
  supplied_on: date,
  note: note(300),
})

/** Logs a delivery to a store. Mistakes are voided, never edited. */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_log_supply', {
      p_outlet: b.outlet_id,
      p_product: b.product_id,
      p_quantity: b.quantity,
      p_batch: b.batch,
      p_expiry: b.expiry_date ?? null,
      p_supplied_on: b.supplied_on,
      p_note: b.note || null,
    })
    return { data, error, audit: ['xm.supply.log', 'xm_supplies', (data as string) ?? null] }
  })
}
