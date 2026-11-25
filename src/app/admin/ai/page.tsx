import { requireSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/admin/page-kit'
import { AiSettings, type AiLimit, type SavedKey, type FeatureChoice } from '@/components/admin/ai-settings'
import { lagosDateString } from '@/lib/utils'
import { aiFor, type AiConnection } from '@/lib/ai/config'
import { modelInUse } from '@/lib/ai/compat'
import type { AiFeature } from '@/lib/ai/providers'

export const dynamic = 'force-dynamic'

interface LimitRow {
  feature: AiFeature
  per_hour: number
  per_day: number
}
interface UsedRow {
  feature: AiFeature
  user_id: string
}

/** Each feature's limits, with today's answers and how many people asked. */
function limitsFor(rows: LimitRow[], used: UsedRow[]): AiLimit[] {
  const defaults: Record<AiFeature, [number, number]> = { staff_helper: [15, 40], admin_assistant: [40, 200] }
  return (['staff_helper', 'admin_assistant'] as AiFeature[]).map((feature) => {
    const row = rows.find((r) => r.feature === feature)
    const today = used.filter((u) => u.feature === feature)
    return {
      feature,
      per_hour: row?.per_hour ?? defaults[feature][0],
      per_day: row?.per_day ?? defaults[feature][1],
      used_today: today.length,
      people_today: new Set(today.map((u) => u.user_id)).size,
    }
  })
}
export const metadata = { title: 'AI keys — Xtend' }

/** Settings → AI (0102): the keys and which AI answers staff and Ask Xtend. Admins only. */
export default async function AiPage() {
  await requireSession(['admin'])
  // The tables are the server's alone; only the hint and dates come out.
  const admin = createAdminSupabase()
  const [{ data: keys, error }, { data: features }, { data: note, error: noteError }, { data: limitRows, error: limitError }, { data: usedRows }, staff, office] = await Promise.all([
    admin.from('ai_provider_keys').select('provider, key_hint, updated_at'),
    admin.from('ai_feature_settings').select('feature, provider, model'),
    admin.from('ai_knowledge').select('body, updated_at').maybeSingle<{ body: string; updated_at: string }>(),
    admin.from('ai_limits').select('feature, per_hour, per_day'),
    // Today's answers per feature (Lagos), for the limits panel.
    admin
      .from('ai_usage')
      .select('feature, user_id')
      .gte('used_at', new Date(`${lagosDateString()}T00:00:00+01:00`).toISOString())
      .limit(20000),
    aiFor('staff_helper'),
    aiFor('admin_assistant'),
  ])
  // A retired model shows the one Xtend switched to (lib/ai/compat.ts).
  const shown = (c: AiConnection) => {
    const now = c.provider === 'anthropic' ? c.model : modelInUse(c)
    return now === c.model ? c.model : `${now} (${c.model} is retired: choose a current model)`
  }
  const using: Record<AiFeature, { provider: string; model: string } | null> = {
    staff_helper: staff ? { provider: staff.provider, model: shown(staff) } : null,
    admin_assistant: office ? { provider: office.provider, model: shown(office) } : null,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI keys"
        note="Add a key for any of these AI services, then choose which one answers staff (the helper that explains what to do when something does not work) and which one answers Ask Xtend. Keys are stored encrypted and never shown again: only their last 4 characters."
      />
      {error && (
        <p className="rounded-xl bg-warning/15 p-3 text-sm">Run migration 0102 in Supabase to save AI keys here.</p>
      )}
      <AiSettings
        saved={(keys ?? []) as SavedKey[]}
        choices={(features ?? []) as FeatureChoice[]}
        using={using}
        serverAnthropic={Boolean(process.env.ANTHROPIC_API_KEY)}
        knowledge={noteError ? null : { body: note?.body ?? '', updatedAt: note?.updated_at ?? null }}
        limits={limitError ? null : limitsFor((limitRows ?? []) as LimitRow[], (usedRows ?? []) as UsedRow[])}
      />
    </div>
  )
}
