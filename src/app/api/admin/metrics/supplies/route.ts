import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { mapText, note } from '@/lib/fields'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')

const schema = z.object({
  outlet_id: z.string().uuid({ message: 'Choose the store' }),
  product_id: z.string().uuid({ message: 'Choose the product' }),
  // Units, or cartons (with how many units are in one when the product
  // does not say yet): the database works out the units (047).
  quantity: z.number().int('Whole units only').min(1, 'At least one unit').max(1_000_000).nullable().optional(),
  cartons: z.number().int('Whole cartons only').min(1, 'At least one carton').max(100_000).nullable().optional(),
  units_per_carton: z.number().int('Whole units only').min(1).max(100_000).nullable().optional(),
  batch: mapText(60).transform((v) => v ?? ''),
  expiry_date: date.nullable().optional(),
  supplied_on: date,
  note: note(300),
}).refine((b) => b.quantity || b.cartons, 'Enter the units or the cartons supplied')

/** Logs a delivery to a store. Mistakes are voided, never edited. */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_log_supply', {
      p_outlet: b.outlet_id,
      p_product: b.product_id,
      p_quantity: b.cartons ? null : (b.quantity ?? null),
      p_batch: b.batch,
      p_expiry: b.expiry_date ?? null,
      p_supplied_on: b.supplied_on,
      p_note: b.note || null,
      p_cartons: b.cartons ?? null,
      p_units_per_carton: b.cartons ? (b.units_per_carton ?? null) : null,
    })
    return { data, error, audit: ['xm.supply.log', 'xm_supplies', (data as string) ?? null] }
  })
}
