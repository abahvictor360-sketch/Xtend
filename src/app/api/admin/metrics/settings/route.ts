import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'

const pct = z.number().int().min(0).max(100)

const schema = z
  .object({
    tolerance_pct: z.number().min(0).max(100),
    weight_sales: pct,
    weight_accuracy: pct,
    weight_consistency: pct,
    weight_expiry: pct,
    band_poor_below: z.number().int().min(1).max(99),
    band_strong_from: z.number().int().min(2).max(100),
    alert_windows_days: z.array(z.number().int().min(1).max(3650)).min(1).max(10),
    velocity_days: z.number().int().min(7).max(365),
    count_interval_days: z.number().int().min(1).max(31),
    sales_grace_hours: z.number().int().min(0).max(72),
    sales_photo_required: z.boolean(),
  })
  .refine((s) => s.weight_sales + s.weight_accuracy + s.weight_consistency + s.weight_expiry === 100, 'The weights must add up to 100')
  .refine((s) => s.band_poor_below < s.band_strong_from, '"Poor below" must be lower than "Strong from"')

/** Changes the X Metrics rules. Every earlier version is kept (043). */
export async function PUT(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const windows = [...new Set(b.alert_windows_days)].sort((x, y) => y - x)
    const { error } = await db.from('xm_settings').update({ ...b, alert_windows_days: windows }).eq('id', true)
    return { error, audit: ['xm.settings.update', 'xm_settings', null] }
  })
}
