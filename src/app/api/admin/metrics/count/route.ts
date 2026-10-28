import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')

const schema = z.object({
  outlet_id: z.string().uuid({ message: 'Choose the store' }),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid({ message: 'Choose the product' }),
        on_shelf: z.number().int('Whole units only').min(0).max(1_000_000),
        in_backroom: z.number().int('Whole units only').min(0).max(1_000_000),
        batch: z.string().max(60).transform((v) => v?.trim() ?? ''),
        expiry_date: date.nullable().optional(),
      }),
    )
    .min(1, 'Count at least one product')
    .max(500, 'Too many lines in one count'),
})

/**
 * Records an office stock count: an admin enters a count (and expiries) from a
 * prompt or a document, without the field GPS and photo gate. It is a real X
 * Metrics count (stock on hand, expiry alerts, reconciliation), recorded in
 * the admin's name. The database (xm_office_count) checks the store and lines.
 */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_office_count', {
      p_outlet: b.outlet_id,
      p_lines: b.lines.map((l) => ({
        product_id: l.product_id,
        on_shelf: l.on_shelf,
        in_backroom: l.in_backroom,
        batch: l.batch,
        expiry_date: l.expiry_date ?? null,
      })),
    })
    return { data, error, audit: ['xm.count.office', 'xm_counts', (data as string) ?? null] }
  })
}
