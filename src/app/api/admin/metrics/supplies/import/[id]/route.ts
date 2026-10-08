import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { mapText, note } from '@/lib/fields'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Every line needs a date')
const whole = z.number().int('Whole numbers only').min(1).max(1_000_000)

const schema = z.object({
  rows: z
    .array(
      z
        .object({
          outlet_id: z.string().uuid({ message: 'Choose the store for every line' }),
          product_id: z.string().uuid({ message: 'Choose the product for every line' }),
          quantity: whole.nullable().optional(),
          cartons: whole.max(100_000).nullable().optional(),
          units_per_carton: whole.max(100_000).nullable().optional(),
          batch: mapText(60).transform((v) => v ?? ''),
          expiry_date: date.nullable().optional().or(z.literal('').transform(() => null)),
          supplied_on: date,
          note: note(300),
        })
        .refine((r) => r.quantity || r.cartons, 'Every line needs units or cartons'),
    )
    .min(1, 'Choose at least one line to log')
    .max(500),
})

/** Logs the lines an admin checked from an import, all or none. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_log_supply_import', {
      p_import: id,
      p_rows: b.rows.map((r) => ({ ...r, quantity: r.cartons ? null : r.quantity, note: r.note || null })),
    })
    return { data, error, audit: ['xm.supply.import_log', 'xm_supply_imports', id, { rows: b.rows.length }] }
  })
}
