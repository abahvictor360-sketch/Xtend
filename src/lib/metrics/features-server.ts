import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { xmFeaturesFrom, type XmFeatures } from '@/lib/metrics/features'

/**
 * The X Metrics switches (0063), read through the caller's client (every
 * signed-in person may read xm_settings). Before 0063 runs, or if the row
 * cannot be read, everything counts as on: X Metrics as it always was.
 */
export async function readXmFeatures(db: SupabaseClient): Promise<XmFeatures> {
  const { data, error } = await db.from('xm_settings').select('*').maybeSingle()
  return xmFeaturesFrom(error ? null : (data as Record<string, unknown> | null))
}
