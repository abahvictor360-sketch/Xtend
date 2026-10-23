import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { readXmFeatures } from '@/lib/metrics/features-server'
import { xmFeatureChanges } from '@/lib/metrics/features'

const schema = z.object({
  enabled: z.boolean(),
  expiry: z.boolean(),
  supplies: z.boolean(),
  grading: z.boolean(),
  sales: z.boolean(),
})

/**
 * Switches X Metrics, or parts of it, on and off (0063). Admins only; the
 * database refuses anyone else, keeps the earlier switches in the settings
 * history, and nothing is deleted.
 */
export async function PUT(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const before = await readXmFeatures(db)
    const { data, error } = await db.rpc('xm_set_features', {
      p_enabled: b.enabled,
      p_expiry: b.expiry,
      p_supplies: b.supplies,
      p_grading: b.grading,
      p_sales: b.sales,
    })
    return {
      data,
      error,
      audit: ['xm.features.update', 'xm_settings', null, { changes: xmFeatureChanges(before, b) }],
    }
  })
}
