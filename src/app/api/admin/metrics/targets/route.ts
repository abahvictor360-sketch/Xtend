import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'

const schema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Choose the month'),
    user_id: z.string().uuid().nullable().optional(),
    outlet_id: z.string().uuid().nullable().optional(),
    target_units: z.number().int('Whole units only').min(1, 'A target is at least 1 unit').max(100_000_000),
  })
  .refine((v) => !!v.user_id !== !!v.outlet_id, 'Choose a person or a store')

/** Sets a month's sales target. The newest wins; earlier ones are kept. */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_set_target', {
      p_month: b.month.length === 7 ? `${b.month}-01` : b.month,
      p_user: b.user_id ?? null,
      p_outlet: b.outlet_id ?? null,
      p_units: b.target_units,
    })
    return { data, error, audit: ['xm.target.set', 'xm_targets', (data as string) ?? null] }
  })
}
