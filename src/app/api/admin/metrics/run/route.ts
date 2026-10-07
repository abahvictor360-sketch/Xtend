import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { runMetricsSweep } from '@/lib/metrics/server'

/** Runs reconciliation and the expiry check now, instead of waiting for cron. */
export async function POST() {
  try {
    await requireApiSession(['admin'])
    const supabase = await createServerSupabase()
    const result = await runMetricsSweep(supabase)
    await audit(supabase, 'xm.sweep.run', null, null, result)
    return Response.json(result)
  } catch (error) {
    return apiError(error)
  }
}
