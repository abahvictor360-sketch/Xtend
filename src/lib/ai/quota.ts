import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import type { AiFeature } from '@/lib/ai/providers'

export type AiQuota =
  | { ok: true; left_hour?: number; left_day?: number }
  | { ok: false; period: 'hour' | 'day'; limit: number }

/**
 * One more AI answer for this person, if they are within their limits
 * (0110, Settings → AI keys). Counted in the database, so it holds across
 * restarts and servers. Before 0110 is run (or if the count cannot be
 * read), it allows the answer: the hourly limit in memory still applies.
 */
export async function takeAiUse(userId: string, feature: AiFeature): Promise<AiQuota> {
  try {
    const { data, error } = await createAdminSupabase().rpc('consume_ai_use', { p_user: userId, p_feature: feature })
    if (error || !data) return { ok: true }
    return data as AiQuota
  } catch {
    return { ok: true }
  }
}
